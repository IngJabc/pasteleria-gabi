import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const passes = [];

function check(name, ok, detail = "") {
  (ok ? passes : failures).push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function gitRaw(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).replace(/\r?\n$/, "");
}

function git(args) {
  return gitRaw(args).trim();
}

function parseJsonc(text) {
  const withoutLineComments = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(withoutLineComments.replace(/,(\s*[}\]])/g, "$1"));
}

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : "";
}

function shellRules(block) {
  const rules = [];
  const pattern =
    /action:\s*shell\s*\r?\n\s*resource:\s*([^\r\n]+)\s*\r?\n\s*effect:\s*(\w+)/g;
  let match;
  while ((match = pattern.exec(block)) !== null) {
    rules.push({ resource: match[1].trim(), effect: match[2].trim() });
  }
  return rules;
}

function nextAction(state) {
  const context = state.context || {};
  const pr = state.pr || {};
  if (context.unrelatedChanges) return "STOP: protect user work";
  if (pr.state === "open") return "STOP: PR awaiting merge";
  if (context.previousObjective && !pr.mergeVerified) {
    return "STOP: verify merge";
  }
  if (context.interruptedBranch) return "RECOVER: resume existing branch";
  if (context.baseDirty) return "STOP: unsafe base";
  if (!context.previousObjective && !context.recovered) {
    return "SYNC main then BRANCH";
  }
  if (context.eligibleTask === false) return "STOP: no executable task";
  return "EXECUTE: one objective";
}

function makeState(patch = {}, template) {
  return {
    ...template,
    ...patch,
    pr: { ...template.pr, ...(patch.pr || {}) },
    context: { ...template.context, ...(patch.context || {}) },
  };
}

// --- 1. Project configuration ------------------------------------------------
const config = parseJsonc(read("opencode.jsonc"));
const allowedTopLevel = new Set([
  "$schema", "shell", "model", "default_agent", "update", "share", "enterprise",
  "username", "timezone", "permissions", "policies", "agents", "snapshots",
  "watcher", "formatter", "lsp", "media", "tool_output", "mcp", "compaction",
  "skills", "commands", "instructions", "references", "websearch", "plugins",
  "worktree", "warming", "providers", "experimental",
]);
const unknownTopLevel = Object.keys(config).filter((key) => !allowedTopLevel.has(key));
check("opencode.jsonc parses and uses native V2 fields", true);
check("config has no unknown top-level keys", unknownTopLevel.length === 0, unknownTopLevel.join(", "));
check("config has no V1 permission field", !("permission" in config));
check("default agent is project-orchestrator", config.default_agent === "project-orchestrator");
check("schema URL is correct", config.$schema === "https://opencode.ai/config.json");
check("permissions is an ordered array", Array.isArray(config.permissions));
check("policies is an array", Array.isArray(config.policies));

const denyPatterns = (config.permissions || [])
  .filter((rule) => rule.action === "shell" && rule.effect === "deny")
  .map((rule) => rule.resource);
const policyDenies = (config.policies || [])
  .filter((rule) => rule.action === "tool.use" && rule.effect === "deny")
  .map((rule) => rule.resource);

const requiredDenies = [
  "git push * main",
  "git push * main *",
  "git push * main:*",
  "git push * refs/heads/main",
  "git push * HEAD:main",
  "git push * HEAD:refs/heads/main",
  "git push * *:main",
  "git push * *:refs/heads/main",
  "git push * +main",
  "git push --force*",
  "git push -f*",
  "git push * --force*",
  "git push * -f*",
  "git push * * --force*",
  "git push * * -f*",
  "git push * +*",
  "git push --all*",
  "git push * --all*",
  "git push --mirror*",
  "git push * --mirror*",
  "git push * --delete*",
  "git push * :*",
  "gh pr merge *",
  "gh pr review *approve*",
  "gh pr review --approve*",
  "git reset --hard*",
  "git clean *",
  "git stash *",
  "git restore *",
  "supabase db push*",
  "supabase db reset*",
  "npx supabase db push*",
  "npx supabase db reset*",
  "npx * supabase db push*",
  "npx * supabase db reset*",
  "npm exec* supabase db push*",
  "npm exec* supabase db reset*",
  "pnpm dlx supabase db push*",
  "pnpm dlx supabase db reset*",
  "pnpm dlx * supabase db push*",
  "pnpm dlx * supabase db reset*",
  "yarn dlx supabase db push*",
  "yarn dlx supabase db reset*",
  "yarn dlx * supabase db push*",
  "yarn dlx * supabase db reset*",
  "bunx supabase db push*",
  "bunx supabase db reset*",
  "bunx * supabase db push*",
  "bunx * supabase db reset*",
];
for (const pattern of requiredDenies) {
  check(`permission deny present: ${pattern}`, denyPatterns.includes(pattern));
  check(`hard policy deny present: shell:${pattern}`, policyDenies.includes(`shell:${pattern}`));
}
check("broad git merge denial is absent", !denyPatterns.includes("git merge *"));
check("all hard policies target tool.use", (config.policies || []).every((rule) => rule.action === "tool.use"));

// --- 2. Agents and command ---------------------------------------------------
const agentsDir = path.join(root, ".opencode", "agents");
const agentFiles = readdirSync(agentsDir).filter((file) => file.endsWith(".md")).sort();
check("primary plus six specialized agents exist", agentFiles.length === 7, agentFiles.join(", "));

const agents = {};
for (const file of agentFiles) {
  const text = read(path.join(".opencode", "agents", file));
  const fm = frontmatter(text);
  const body = text.replace(/^---[\s\S]*?---/, "").trim();
  agents[file] = { fm, body };
  check(`${file}: has description`, /^description:\s*\S+/m.test(fm));
  check(`${file}: has V2 mode`, /^mode:\s*(primary|subagent|all)$/m.test(fm));
  check(`${file}: body is substantive`, body.length > 100);
  check(`${file}: no legacy V1 frontmatter fields`, !/^(prompt|permission|disable|tools|temperature|maxSteps|task|bash):/m.test(fm));
  const unsafeAllow = shellRules(fm).some(
    (rule) =>
      rule.effect === "allow" &&
      (/git push/.test(rule.resource) ||
        /gh pr (merge|review)/.test(rule.resource) ||
        /git (reset|clean|stash|restore)/.test(rule.resource) ||
        /supabase db (push|reset)/.test(rule.resource)),
  );
  check(`${file}: no agent allow overrides a safety denial`, !unsafeAllow);
}

check("project-orchestrator is primary", /^mode:\s*primary$/m.test(agents["project-orchestrator.md"]?.fm || ""));
for (const file of agentFiles.filter((name) => name !== "project-orchestrator.md")) {
  check(`${file}: subagent mode`, /^mode:\s*subagent$/m.test(agents[file].fm));
}
for (const file of ["autopilot-planner.md", "autopilot-reviewer.md", "autopilot-qa.md", "autopilot-security.md"]) {
  check(`${file}: edit denied`, /action:\s*edit[\s\S]*?effect:\s*deny/.test(agents[file]?.fm || ""));
}
for (const file of agentFiles.filter((name) => name !== "project-orchestrator.md")) {
  const fm = agents[file].fm;
  check(`${file}: cannot commit`, /git commit \*/.test(fm) && /effect:\s*deny/.test(fm));
  check(`${file}: cannot push`, /git push \*/.test(fm) && /effect:\s*deny/.test(fm));
  check(`${file}: cannot open a PR`, /gh pr \*/.test(fm) && /effect:\s*deny/.test(fm));
}

const orchestrationBody = agents["project-orchestrator.md"]?.body || "";
const orchestratorPhrases = [
  /never push to `main`/i,
  /never merge/i,
  "previous PR is actually merged",
  /skill[^\w]{0,4}tool/i,
  "docs/skills-catalog.md",
  "one coherent development objective",
  "autopilot-planner", "autopilot-implementer", "autopilot-reviewer",
  "autopilot-qa", "autopilot-security", "autopilot-docs",
];
for (const phrase of orchestratorPhrases) {
  const ok = phrase instanceof RegExp ? phrase.test(orchestrationBody) : orchestrationBody.includes(phrase);
  check(`orchestrator instruction present: ${phrase}`, ok);
}

const commandText = read(".opencode/commands/autopilot.md");
check("command selects project-orchestrator", /^agent:\s*project-orchestrator$/m.test(commandText));
check("command has description", /^description:\s*\S+/m.test(commandText));
check("command passes $ARGUMENTS", commandText.includes("$ARGUMENTS"));
check("command stops at human merge checkpoint", /human merge checkpoint/i.test(commandText));
check("command has no V1 frontmatter fields", !/^(agent|description)\s*:/m.test(commandText.replace(/^agent:.*\r?\n|^description:.*\r?\n/gm, "")));

// --- 3. Skills, docs and state template -------------------------------------
const catalog = read("docs/skills-catalog.md");
const expectedSkills = [
  "accessibility", "best-practices", "browser", "core-web-vitals", "deploy-to-vercel",
  "modern-web-guidance", "opencode", "performance", "react-best-practices",
  "react-native-skills", "react-view-transitions", "report", "security-audit", "seo",
  "supabase", "supabase-postgres-best-practices", "ui-ux-pro-max",
  "vercel-cli-with-tokens", "vercel-optimize", "web-design-guidelines",
  "web-quality-audit", "writing-guidelines",
];
const missingSkills = expectedSkills.filter((id) => !catalog.includes(`\`${id}\``));
check("skill catalog lists all 22 discovered IDs", missingSkills.length === 0, missingSkills.join(", "));
check("catalog documents skill invocation", catalog.includes("{ \"id\": \"ui-ux-pro-max\" }"));

const globalSkillRoot = path.join(homedir(), ".config", "opencode", "skill");
const globalSkillIds = existsSync(globalSkillRoot)
  ? readdirSync(globalSkillRoot).filter((id) => existsSync(path.join(globalSkillRoot, id, "SKILL.md")))
  : [];
check("19 global SKILL.md files discovered", globalSkillIds.length === 19, String(globalSkillIds.length));
const unexpectedGlobal = globalSkillIds.filter((id) => !expectedSkills.includes(id));
check("no undiscovered global skill is missing from catalog", unexpectedGlobal.length === 0, unexpectedGlobal.join(", "));

const stateTemplate = parseJsonc(read(".opencode/autopilot-state.example.json"));
for (const field of ["version", "objective", "branch", "phase", "base", "pushRemote", "commits", "pr", "validation", "context", "nextAction", "updatedAt"]) {
  check(`state template has ${field}`, field in stateTemplate);
}
check("state template has no real PR", stateTemplate.pr.number === null && stateTemplate.pr.state === "none");
for (const field of ["previousObjective", "unrelatedChanges", "interruptedBranch", "baseDirty", "eligibleTask", "recovered"]) {
  check(`state template context has ${field}`, field in stateTemplate.context);
}
check("state cache is gitignored", read(".gitignore").includes("/.opencode/autopilot-state.json"));

const workflowDoc = read("docs/AUTONOMOUS_WORKFLOW.md");
for (const phrase of ["fork: false", "no separate fork", "GitHub CLI", "validate:autopilot", "hard V2 policies", "human merge checkpoint"]) {
  check(`workflow doc states: ${phrase}`, workflowDoc.includes(phrase));
}
check("TASKS documents the workflow objective", read("TASKS.md").includes("reusable autonomous OpenCode workflow"));
check("ROADMAP documents the workflow", read("docs/ROADMAP.md").includes("autonomous OpenCode workflow"));
const readme = read("README.md");
check("README links the workflow docs", readme.includes("docs/AUTONOMOUS_WORKFLOW.md") && readme.includes("docs/skills-catalog.md"));
const pkg = JSON.parse(read("package.json"));
check("package.json exposes validate:autopilot", pkg.scripts["validate:autopilot"] === "node scripts/validate-autopilot.mjs");

// --- 4. Repository state and simulated recovery ------------------------------
const remoteLines = git(["remote", "-v"]).split(/\r?\n/).filter(Boolean);
const remoteNames = new Set(remoteLines.map((line) => line.split(/\s+/)[0]));
check("only the verified origin remote exists", remoteNames.size === 1 && remoteNames.has("origin"), [...remoteNames].join(", "));
check("origin URL is the verified repository", remoteLines.every((line) => line.includes("https://github.com/IngJabc/pasteleria-gabi.git")));
const branch = git(["branch", "--show-current"]);
check("work is on a feature branch", /^features\//.test(branch), branch);

const changedPaths = gitRaw(["status", "--porcelain"])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/^"|"$/g, ""));
const forbiddenChanges = changedPaths.filter((filePath) =>
  /(^|\/)\.env($|\.)|(^|\/)node_modules\/|(^|\/)\.next\/|(^|\/)dist\/|(^|\/)build\/|(^|\/)coverage\/|\.tsbuildinfo$|\.log$/i.test(filePath),
);
check("no secret or generated files are changed", forbiddenChanges.length === 0, forbiddenChanges.join(", "));

const scenarios = [
  ["open PR stops", makeState({ context: { previousObjective: true }, pr: { number: 10, state: "open", mergeVerified: false } }, stateTemplate), "STOP: PR awaiting merge"],
  ["unrelated changes stop", makeState({ context: { unrelatedChanges: true } }, stateTemplate), "STOP: protect user work"],
  ["unverified merge stops", makeState({ context: { previousObjective: true }, pr: { number: 10, state: "closed", mergeVerified: false } }, stateTemplate), "STOP: verify merge"],
  ["interrupted work recovers", makeState({ context: { previousObjective: true, interruptedBranch: true }, pr: { number: 10, state: "merged", mergeVerified: true } }, stateTemplate), "RECOVER: resume existing branch"],
  ["dirty base stops", makeState({ context: { previousObjective: true, baseDirty: true }, pr: { number: 10, state: "merged", mergeVerified: true } }, stateTemplate), "STOP: unsafe base"],
  ["verified merge continues", makeState({ context: { previousObjective: true }, pr: { number: 10, state: "merged", mergeVerified: true } }, stateTemplate), "EXECUTE: one objective"],
  ["fresh objective syncs first", makeState({}, stateTemplate), "SYNC main then BRANCH"],
  ["no eligible task stops", makeState({ context: { previousObjective: true, eligibleTask: false }, pr: { number: 10, state: "merged", mergeVerified: true } }, stateTemplate), "STOP: no executable task"],
];
for (const [name, state, expected] of scenarios) {
  check(`recovery scenario: ${name}`, nextAction(state) === expected, nextAction(state));
}

// --- Result ------------------------------------------------------------------
console.log(`PASSED: ${passes.length}`);
console.log(`FAILED: ${failures.length}`);
if (failures.length) {
  console.log(`\nFAILURES:\n${failures.map((item) => ` - ${item}`).join("\n")}`);
  process.exit(1);
}
console.log("\nAll definition, policy, skill, Git-safety and recovery checks passed.");
