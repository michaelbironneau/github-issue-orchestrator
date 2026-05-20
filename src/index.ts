import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Octokit } from "@octokit/rest";
import { graphql as createGraphql } from "@octokit/graphql";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeForPiArg(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Config {
  owner: string;
  repo: string;
  projectNumber: number;
  backlogColumn: string;
  readyColumn: string;
  inProgressColumn: string;
  inReviewColumn: string;
  doneColumn: string;
  baseBranch: string;

}

interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  column: string;
  itemNodeId: string;
}

interface ProjectMeta {
  projectNodeId: string;
  statusFieldId: string;
  columnOptionIds: Record<string, string>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig(cwd: string): Config {
  const settingsPath = path.join(cwd, ".pi", "settings.json");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    throw new Error(`Cannot read ${settingsPath}. Create .pi/settings.json with a "githubOrchestrator" key.`);
  }
  const cfg = raw["githubOrchestrator"] as Partial<Config> | undefined;
  if (!cfg) throw new Error(`Please configure your pi settings for Github issue orchestration. Instructions: https://github.com/michaelbironneau/github-issue-orchestrator.`);
  if (!cfg.owner) throw new Error(`githubOrchestrator.owner is required`);
  if (!cfg.repo) throw new Error(`githubOrchestrator.repo is required`);
  if (!cfg.projectNumber) throw new Error(`githubOrchestrator.projectNumber is required`);
  return {
    backlogColumn: "Backlog",
    readyColumn: "Ready",
    inProgressColumn: "In Progress",
    inReviewColumn: "In Review",
    doneColumn: "Done",
    baseBranch: "main",
    ...cfg,
  } as Config;
}

// ─── Auth & Clients ───────────────────────────────────────────────────────────

async function getToken(pi: ExtensionAPI): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  const result = await pi.exec("gh", ["auth", "token"]);
  if (result.code !== 0 || !result.stdout.trim()) {
    throw new Error("No GITHUB_TOKEN env var and `gh auth token` failed. Set GITHUB_TOKEN or run `gh auth login`.");
  }
  return result.stdout.trim();
}

// ─── Project Metadata (lazy, cached) ─────────────────────────────────────────

let projectMetaCache: ProjectMeta | null = null;

/**
 * Query a GitHub Project v2 by owner. Tries `organization(login: $owner)` first;
 * if the project is not found (e.g. the owner is a personal account), falls back
 * to `user(login: $owner)`. Returns the raw project node from whichever scope
 * matched.
 */
async function queryProjectV2<TFields>(
  gql: ReturnType<typeof createGraphql.defaults>,
  owner: string,
  projectNumber: number,
  fieldFragment: string,
): Promise<TFields> {
  // Try organization scope first
  const orgData = await gql<{
    organization: { projectV2: TFields | null } | null;
  }>(
    `query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) { ${fieldFragment} }
      }
    }`,
    { owner, number: projectNumber },
  ).catch(() => null);

  if (orgData?.organization?.projectV2) return orgData.organization.projectV2;

  // Fall back to user scope (personal account)
  const userData = await gql<{
    user: { projectV2: TFields | null } | null;
  }>(
    `query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) { ${fieldFragment} }
      }
    }`,
    { owner, number: projectNumber },
  );

  if (userData?.user?.projectV2) return userData.user.projectV2;

  throw new Error(
    `Project #${projectNumber} not found under organization or user "${owner}". ` +
    `Verify owner/projectNumber in .pi/settings.json and that your token has access.`,
  );
}

async function fetchProjectMeta(
  gql: ReturnType<typeof createGraphql.defaults>,
  cfg: Config,
): Promise<ProjectMeta> {
  if (projectMetaCache) return projectMetaCache;

  interface ProjectFields {
    id: string;
    fields: {
      nodes: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>;
    };
  }

  const project = await queryProjectV2<ProjectFields>(
    gql,
    cfg.owner,
    cfg.projectNumber,
    `id
     fields(first: 20) {
       nodes {
         ... on ProjectV2SingleSelectField {
           id
           name
           options { id name }
         }
       }
     }`,
  );

  const statusField = project.fields.nodes.find(
    (f) => f.name === "Status" && f.options,
  );
  if (!statusField?.options) throw new Error("No 'Status' single-select field found in GitHub Project.");

  const columnOptionIds: Record<string, string> = {};
  for (const opt of statusField.options) {
    columnOptionIds[opt.name] = opt.id;
  }

  projectMetaCache = { projectNodeId: project.id, statusFieldId: statusField.id, columnOptionIds };
  return projectMetaCache;
}

// ─── Issue Fetching ───────────────────────────────────────────────────────────

async function listIssues(
  gql: ReturnType<typeof createGraphql.defaults>,
  cfg: Config,
  column?: string,
  labels?: string[],
): Promise<Issue[]> {
  interface ProjectItems {
    items: {
      nodes: Array<{
        id: string;
        fieldValueByName: { name?: string } | null;
        content: {
          __typename: string;
          number: number;
          title: string;
          body: string;
          labels: { nodes: Array<{ name: string }> };
        } | null;
      }>;
    };
  }

  const project = await queryProjectV2<ProjectItems>(
    gql,
    cfg.owner,
    cfg.projectNumber,
    `items(first: 100) {
       nodes {
         id
         fieldValueByName(name: "Status") {
           ... on ProjectV2ItemFieldSingleSelectValue { name }
         }
         content {
           __typename
           ... on Issue {
             number title body
             labels(first: 10) { nodes { name } }
           }
         }
       }
     }`,
  );

  return project.items.nodes
    .filter((item) => item.content?.__typename === "Issue")
    .map((item) => ({
      number: item.content!.number,
      title: item.content!.title,
      body: item.content!.body ?? "",
      labels: item.content!.labels.nodes.map((l) => l.name),
      column: item.fieldValueByName?.name ?? "",
      itemNodeId: item.id,
    }))
    .filter((issue) => {
      if (column && issue.column !== column) return false;
      if (labels?.length && !labels.every((l) => issue.labels.includes(l))) return false;
      return true;
    });
}

// ─── Extension Factory ────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  // Defer config/auth until first use so the extension doesn't fail at load
  // time when .pi/settings.json doesn't exist yet.
  let cfg: Config;
  let octokit: Octokit;
  let gql: ReturnType<typeof createGraphql.defaults>;

  async function init() {
    if (octokit) return;
    cfg = loadConfig(process.cwd());
    const token = await getToken(pi);
    octokit = new Octokit({ auth: token });
    gql = createGraphql.defaults({ headers: { authorization: `token ${token}` } });
  }

  // ─── session_start: deploy bundled agents to the appropriate discovery path ─

  pi.on("session_start", async (_event) => {
    const agentsSrc = path.join(__dirname, "..", "agents");
    const extensionDir = path.join(__dirname, "..");
    const globalBase = path.join(os.homedir(), ".pi", "agent");
    const isGlobal = extensionDir.startsWith(globalBase + path.sep);
    const targetDir = isGlobal
      ? path.join(globalBase, "agents")
      : path.join(process.cwd(), ".pi", "agents");
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of fs.readdirSync(agentsSrc)) {
      fs.copyFileSync(path.join(agentsSrc, file), path.join(targetDir, file));
    }
  });

  // ─── Tools ─────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "gh_list_issues",
    label: "List GitHub Issues",
    description: "Fetch the GitHub Project board as a task board grouped by column",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      await init();
      const issues = await listIssues(gql, cfg);
      const byColumn: Record<string, Issue[]> = {};
      for (const issue of issues) {
        (byColumn[issue.column] ??= []).push(issue);
      }
      const lines: string[] = [];
      for (const [col, items] of Object.entries(byColumn)) {
        lines.push(`## ${col}`);
        for (const item of items) {
          const labelStr = item.labels.length ? ` [${item.labels.join(", ")}]` : "";
          lines.push(`- #${item.number} ${item.title}${labelStr}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") || "No issues found." }], details: {} };
    },
  });

  pi.registerTool({
    name: "gh_move_issue",
    label: "Move GitHub Issue",
    description: "Move an issue to a different project column",
    parameters: Type.Object({
      issueNumber: Type.Number({ description: "Issue number" }),
      column: Type.String({ description: "Target column name (e.g. 'In Review')" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await init();
      const meta = await fetchProjectMeta(gql, cfg);
      const optionId = meta.columnOptionIds[params.column];
      if (!optionId) {
        throw new Error(`Column "${params.column}" not found. Available: ${Object.keys(meta.columnOptionIds).join(", ")}`);
      }
      const issues = await listIssues(gql, cfg);
      const issue = issues.find((i) => i.number === params.issueNumber);
      if (!issue) throw new Error(`Issue #${params.issueNumber} not found in this project.`);

      await gql(
        `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $project
            itemId: $item
            fieldId: $field
            value: { singleSelectOptionId: $option }
          }) { projectV2Item { id } }
        }`,
        { project: meta.projectNodeId, item: issue.itemNodeId, field: meta.statusFieldId, option: optionId },
      );
      return { content: [{ type: "text", text: `Moved #${params.issueNumber} to "${params.column}".` }], details: {} };
    },
  });

  pi.registerTool({
    name: "gh_remove_label",
    label: "Remove GitHub Label",
    description: "Remove a label from an issue",
    parameters: Type.Object({
      issueNumber: Type.Number({ description: "Issue number" }),
      label: Type.String({ description: "Label name to remove" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await init();
      await octokit.issues.removeLabel({
        owner: cfg.owner,
        repo: cfg.repo,
        issue_number: params.issueNumber,
        name: params.label,
      });
      return { content: [{ type: "text", text: `Removed label "${params.label}" from #${params.issueNumber}.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "gh_create_pr",
    label: "Create GitHub PR",
    description: "Open a pull request on the current branch linked to an issue",
    parameters: Type.Object({
      issueNumber: Type.Number({ description: "Issue number to link (added as 'Closes #N' in body)" }),
      title: Type.String({ description: "PR title" }),
      body: Type.Optional(Type.String({ description: "Additional PR description" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await init();
      const branchResult = await pi.exec("git", ["branch", "--show-current"]);
      const head = branchResult.stdout.trim();
      if (!head) throw new Error("Could not determine current git branch.");

      const closesLine = `Closes #${params.issueNumber}`;
      const body = params.body ? `${params.body}\n\n${closesLine}` : closesLine;

      const { data: pr } = await octokit.pulls.create({
        owner: cfg.owner,
        repo: cfg.repo,
        title: params.title,
        head,
        base: cfg.baseBranch,
        body,
      });
      return { content: [{ type: "text", text: `Created PR #${pr.number}: ${pr.html_url}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "gh_update_issue",
    label: "Update GitHub Issue",
    description: "Update an issue's title and/or body (description). Overwrites the previous values.",
    parameters: Type.Object({
      issueNumber: Type.Number({ description: "Issue number" }),
      title: Type.Optional(Type.String({ description: "New title (omit to keep current)" })),
      body: Type.Optional(Type.String({ description: "New body/description in markdown (omit to keep current)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await init();
      const { data: issue } = await octokit.issues.update({
        owner: cfg.owner,
        repo: cfg.repo,
        issue_number: params.issueNumber,
        ...(params.title !== undefined && { title: params.title }),
        ...(params.body !== undefined && { body: params.body }),
      });
      return { content: [{ type: "text", text: `Updated #${params.issueNumber}: ${issue.html_url}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "gh_add_comment",
    label: "Add GitHub Comment",
    description: "Post a comment on an issue",
    parameters: Type.Object({
      issueNumber: Type.Number({ description: "Issue number" }),
      body: Type.String({ description: "Comment text (markdown supported)" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await init();
      const { data: comment } = await octokit.issues.createComment({
        owner: cfg.owner,
        repo: cfg.repo,
        issue_number: params.issueNumber,
        body: params.body,
      });
      return { content: [{ type: "text", text: `Comment posted: ${comment.html_url}` }], details: {} };
    },
  });

  // ─── Hook: block direct pushes to base branch ──────────────────────────────

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;
    const cmd: string = (event.input as { command?: string }).command ?? "";
    const baseBranch = cfg?.baseBranch ?? "main";
    // Match: git push [remote] main/master, or git push --force/-f
    const pushToBase = new RegExp(`git\\s+push(?:\\s+\\S+)?\\s+(?:${baseBranch}|master)(?:\\s|$)`);
    const forcePush = /git\s+push\s+(?:.*\s)?(?:--force|-f)(?:\s|$)/;
    if (pushToBase.test(cmd) || forcePush.test(cmd)) {
      return {
        block: true,
        reason: `Direct push to ${baseBranch} is blocked. Use the gh_create_pr tool to open a pull request instead.`,
      };
    }
  });

  // ─── Commands ──────────────────────────────────────────────────────────────

  pi.registerCommand("plan-all", {
    description: "Fan out planner agents for all Backlog issues labelled needs-planning",
    handler: async (_args, ctx) => {
      await init();
      let issues = await listIssues(gql, cfg, cfg.backlogColumn, ["needs-planning"]);
      // Filter out issues labelled 'human' — those are reserved for human planning
      const humanCount = issues.filter((i) => i.labels.includes("human")).length;
      issues = issues.filter((i) => !i.labels.includes("human"));
      if (humanCount > 0) {
        ctx.ui.notify(`Skipped ${humanCount} issue(s) labelled 'human' (reserved for human planning).`, "info");
      }
      if (issues.length === 0) {
        ctx.ui.notify("No needs-planning issues found in the Backlog column.", "info");
        return;
      }
      const tasks = issues.map((issue) => {
        const task = escapeForPiArg(`Plan #${issue.number}: ${issue.title}\n${issue.body}`);
        return `ghplanner[worktree=true] "${task}"`;
      });
      await pi.sendUserMessage(`/parallel ${tasks.join(" -> ")}`, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("plan", {
    description: "Plan a single issue: /plan <issueNumber> [instructions]",
    handler: async (args, ctx) => {
      await init();
      const trimmed = (args ?? "").trim();
      const match = trimmed.match(/^(\d+)(?:\s+(.*))?$/s);
      if (!match) {
        ctx.ui.notify("Usage: /plan <issueNumber> [optional instructions]", "error");
        return;
      }
      const issueNumber = parseInt(match[1], 10);
      const extraInstructions = (match[2] ?? "").trim();

      const { data: issue } = await octokit.issues.get({
        owner: cfg.owner,
        repo: cfg.repo,
        issue_number: issueNumber,
      });

      const issueLabels: string[] = (issue.labels as Array<{ name: string } | string>).map((l) =>
        typeof l === "string" ? l : l.name,
      );
      if (issueLabels.includes("human")) {
        ctx.ui.notify(
          `Issue #${issueNumber} is labelled 'human' and is reserved for human planning and implementation only.`,
          "error",
        );
        return;
      }

      const taskContent = `Plan #${issueNumber}: ${issue.title}\n${issue.body ?? ""}`;
      const fullTask = extraInstructions
        ? `${taskContent}\n\nAdditional instructions: ${extraInstructions}`
        : taskContent;
      const cmd = `/run ghplanner "${escapeForPiArg(fullTask)}"`;
      await pi.sendUserMessage(cmd, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("dispatch", {
    description: "Fan out worker agents for all issues in the Ready column",
    handler: async (_args, ctx) => {
      await init();
      const readyColumn = cfg.readyColumn;
      let issues = await listIssues(gql, cfg, readyColumn);
      // Filter out issues labelled 'human' — those are reserved for human implementation
      const humanCount = issues.filter((i) => i.labels.includes("human")).length;
      issues = issues.filter((i) => !i.labels.includes("human"));
      if (humanCount > 0) {
        ctx.ui.notify(`Skipped ${humanCount} issue(s) labelled 'human' (reserved for human implementation).`, "info");
      }
      if (issues.length === 0) {
        ctx.ui.notify(`No issues found in the "${readyColumn}" column.`, "info");
        return;
      }
      const tasks = issues.map((issue) => {
        const task = escapeForPiArg(`implement #${issue.number}: ${issue.title}\n${issue.body}`);
        return `ghworker[worktree=true] "${task}"`;
      });
      await pi.sendUserMessage(`/parallel ${tasks.join(" -> ")}`, { deliverAs: "followUp" });
    },
  });
}
