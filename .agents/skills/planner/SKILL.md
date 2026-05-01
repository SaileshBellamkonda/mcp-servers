---
name: planner
description: "Use when you need to create an implementation plan as atomic YAML task files. Use for: breaking down specs or feature requests into step-by-step tasks; creating task YAML files for agentic execution; generating plans that an agent can follow without ambiguity. Each task becomes a separate YAML file following the YAML-SCHEMA. Output goes to docs/plans/. Does NOT execute tasks — planning only."
argument-hint: "Feature name or spec to plan (e.g. 'git-clone tool', 'auth middleware')"
---

# Planner Skill

## Purpose

Produce a set of atomic YAML task files from a spec or feature request. Each YAML file is a single, self-contained task that an agent can execute autonomously without asking questions.

**Announce at start:** "I'm using the planner skill to generate atomic YAML task files."

**Output directory:** `docs/plans/YYYY-MM-DD-<feature-name>/`  
One YAML file per task: `task-01-<slug>.yaml`, `task-02-<slug>.yaml`, …

## YAML-SCHEMA Reference

The canonical schema is at [./YAML-SCHEMA.md](./YAML-SCHEMA.md). Read it before generating any YAML files. The key rules are repeated below for quick reference.

---

## Planning Process

### Step 1 — Gather Requirements

Collect the following before writing any YAML:

- **Goal**: What does the completed feature do?
- **Spec location**: Is there a spec file in `docs/specs/`? Read it.
- **Existing code**: Which files already exist that will be touched?
- **Tech stack**: Language, framework, test runner, package manager.
- **Constraints**: TDD required? Lint rules? Commit conventions?

If any of these are missing, ask the user before proceeding.

### Step 2 — Map Files

List every file that will be **created** or **modified**:

```
CREATE  src/tools/git-clone.ts
CREATE  tests/unit/tools/git-clone.test.ts
MODIFY  src/server/git-server.ts   (register new tool)
MODIFY  src/tools/index.ts         (export new tool)
```

One responsibility per file. Small, focused files. Follow existing patterns in the codebase.

### Step 3 — Define Tasks

Decompose the work into atomic tasks. Apply these rules:

| Rule | Meaning |
|------|---------|
| **Atomic** | One task = one logical unit of work (write a test, implement a function, update an export) |
| **TDD order** | Always: write failing test → implement → verify green → commit |
| **2-5 minutes** | If a task would take longer, split it |
| **No skipping** | Tasks must be executable in sequence without human decisions |
| **Idempotent** | Each task must be safe to retry |

**Typical TDD task sequence for a new tool:**

```
task-01  Write failing unit test for the tool
task-02  Implement the tool (minimal code to pass test)
task-03  Register tool in the server
task-04  Write integration test
task-05  Commit
```

### Step 4 — Write YAML Files

For each task, produce a YAML file. Follow the rules in the next section exactly.

---

## Test-Driven Development (TDD) Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Every plan MUST order tasks so that:
1. A test file is created and the test is confirmed to **fail** before any implementation exists.
2. The implementation is written only after the failing test is in place.
3. Tests are verified to **pass** after implementation.

If a plan step writes implementation code before its test step, the plan is invalid. Reorder before saving.

### Red-Green-Refactor in Plans

Map the TDD cycle directly to tasks:

| TDD Phase | Task |
|-----------|------|
| **RED** | Write failing test; confirm it fails with expected message |
| **GREEN** | Write minimal implementation; confirm test passes |
| **REFACTOR** | Clean up; confirm all tests remain green |
| **COMMIT** | Stage only plan-related files; commit with descriptive message |

### Confirming RED

Every test-writing task MUST include a step that runs the test and asserts failure:

```yaml
- step_number: 2
  description: Confirm the test fails (RED phase)
  command: pnpm test --run tests/unit/tools/git-clone.test.ts 2>&1; echo "EXIT:$?"
  working_directory: packages/server-git
  validation_checkpoint:
    description: Test must fail — feature not yet implemented
    command: pnpm test --run tests/unit/tools/git-clone.test.ts 2>&1 | grep -c "FAIL\|failed\|error"
    expected_output: "1"
    on_failure:
      action: stop
```

A test task whose validation checkpoint asserts **success** is a plan defect. The checkpoint must assert **failure**.

### Step 5 — Write an Index

After all task files are created, write `docs/plans/YYYY-MM-DD-<feature-name>/README.md` with:
- Feature goal (one sentence)
- Ordered list of task files with one-line descriptions
- How to verify the whole plan is complete

---

## OS-Aware Command Generation

Before writing any commands, detect the target environment. Ask the user if not obvious from context.

| Environment | Shell | Path separator | Existence check | Exit code check |
|-------------|-------|----------------|-----------------|-----------------|
| **Linux / macOS** | bash/sh | `/` | `test -f <path>` | `; echo "EXIT:$?"` |
| **Windows** | PowerShell | `\` | `Test-Path <path>` | `; Write-Host "EXIT:$LASTEXITCODE"` |

**Linux/macOS example:**
```yaml
command: test -d packages/server-git/node_modules
expected_output: "EXIT:0"
```

**Windows (PowerShell) example:**
```yaml
command: Test-Path packages\server-git\node_modules
expected_output: "True"
```

Rules:
- Pick one shell per plan — do not mix bash and PowerShell in the same task set.
- Use `node -e "..."` for cross-platform JavaScript checks where possible; these work on both platforms.
- On Windows, replace `&&` with `;` and `|` grep patterns with `Select-String`.
- On Windows, replace `rm -rf` with `Remove-Item -Recurse -Force`.

---

## YAML Rules

### Rule 1: No Placeholders

Every command must be literal and runnable as-is.

❌ BAD
```yaml
command: node -e "require('./packages/<package-name>/src/index.ts')"
```

✅ GOOD
```yaml
command: node -e "require('./packages/server-git/src/index.ts')"
```

### Rule 2: Complete File Content

When a step creates or modifies a file, include the **full file content** in `content:`. Never use comments like `// ... existing code ...` or `# rest of file unchanged`.

❌ BAD
```yaml
content: |
  // ... existing imports ...
  import { gitClone } from './git-clone.js';
  // ... rest of file ...
```

✅ GOOD
```yaml
content: |
  import { gitStatus } from './git-status.js';
  import { gitLog } from './git-log.js';
  import { gitClone } from './git-clone.js';
  
  export { gitStatus, gitLog, gitClone };
```

### Rule 3: Literal Expected Outputs

`expected_output` must be an exact string or a simple pattern. Avoid vague descriptions.

❌ BAD
```yaml
expected_output: "tests pass"
```

✅ GOOD
```yaml
expected_output: "✓ 3 tests passed"
```

When exact output is variable, prefer exit-code checks:

```yaml
command: pnpm test --run 2>&1; echo "EXIT:$?"
expected_output: "EXIT:0"
```

### Rule 4: One Action Per Step

Each `implementation_step` does exactly one thing. No compound steps.

❌ BAD
```yaml
- step_number: 1
  description: Install deps and build
  command: pnpm install && pnpm build
```

✅ GOOD
```yaml
- step_number: 1
  description: Install dependencies
  command: pnpm install
  working_directory: packages/server-git
  validation_checkpoint:
    description: node_modules exists
    command: test -d packages/server-git/node_modules
    expected_output: exit code 0
    on_failure:
      action: stop

- step_number: 2
  description: Build TypeScript
  command: pnpm build
  working_directory: packages/server-git
  validation_checkpoint:
    description: dist directory created
    command: test -d packages/server-git/dist
    expected_output: exit code 0
    on_failure:
      action: stop
```

### Rule 5: Explicit Working Directories

Always set `working_directory` on every command step. Never assume cwd.

### Rule 6: Test-First Task Order

The task that writes the **failing test** must always come before the task that writes the **implementation**. Include a step to confirm the test fails with the expected error:

```yaml
- step_number: 2
  description: Confirm the test fails (RED phase)
  command: pnpm test --run tests/unit/tools/git-clone.test.ts 2>&1; echo "EXIT:$?"
  working_directory: packages/server-git
  validation_checkpoint:
    description: Test must fail at this point
    command: pnpm test --run tests/unit/tools/git-clone.test.ts 2>&1 | grep -c "FAIL\|failed\|error"
    expected_output: "1"
    on_failure:
      action: stop
```

### Rule 7: Minimal `git_commit` per Phase

Only enable `git_commit` at natural commit points (after GREEN + passing tests). Set `files_to_stage` to an explicit list — never use `.` or `*`.

```yaml
git_commit:
  enabled: true
  message_template: "feat(server-git): add git-clone tool"
  files_to_stage:
    - packages/server-git/src/tools/git-clone.ts
    - packages/server-git/tests/unit/tools/git-clone.test.ts
    - packages/server-git/src/tools/index.ts
```

### Rule 8: Short `task_id` Prefix

Use the format: `<plan-slug>-<zero-padded-number>-<action-slug>`

Examples:
- `git-clone-01-write-test`
- `git-clone-02-implement`
- `git-clone-03-register`

---

## YAML File Template

Use this as the starting template for every task YAML file:

```yaml
task_id: <plan-slug>-<NN>-<action-slug>
task_name: "<Human-readable name>"
depends_on: []   # or ["<task-id-of-prerequisite>"]

preconditions:
  - condition: "<What must be true before starting>"
    verification_command: "<exact shell command>"
    expected_result: "exit code 0"

environment:
  required_tools:
    - tool: node
      version: "22.0.0+"
      check_command: node --version
    - tool: pnpm
      version: "9.0.0+"
      check_command: pnpm --version

implementation_steps:
  - step_number: 1
    description: "<What this step does>"
    action_type: command   # command | file_create | file_modify
    command: "<exact command>"
    working_directory: "<relative/path/from/repo/root>"
    validation_checkpoint:
      description: "<What success looks like>"
      command: "<verification command>"
      expected_output: "<exact string or EXIT:0>"
      on_failure:
        action: stop   # stop | retry | rollback
        max_retries: 1

validation_steps:
  - step_number: 1
    description: "<What is being validated>"
    command: "<exact command>"
    expected_output: "<exact string or EXIT:0>"
    on_failure:
      action: stop
      rollback_ref: ""

rollback_procedures:
  - failure_state: "<description of failure>"
    detection_command: "<command that detects it>"
    detection_pattern: "<string to grep for>"
    recovery_steps:
      - step_number: 1
        action: git restore <file-path>
        verification: git status --porcelain <file-path>

postconditions:
  - assertion: "<State that must be true when done>"
    verification_command: "<exact command>"
    expected_result: "exit code 0"

git_commit:
  enabled: false
  message_template: ""
  files_to_stage: []
  pre_commit_checks:
    - check: "All tests pass"
      command: pnpm test --run 2>&1; echo "EXIT:$?"
      expected_result: "EXIT:0"

traceability:
  original_requirement: "<Reference to spec or requirement>"
  acceptance_criteria:
    - "<Criterion 1>"
    - "<Criterion 2>"

metadata:
  complexity: simple   # simple | moderate | complex
  idempotent: true
  autonomous_executable: true
```

---

## Quality Checklist

Before saving any YAML file, verify every item:

- [ ] `task_id` is unique and follows the naming convention
- [ ] `depends_on` lists all prerequisite task IDs
- [ ] Every `precondition` has an exact `verification_command`
- [ ] Every `implementation_step` has a `validation_checkpoint`
- [ ] No step uses placeholders (no `<value>`, `{name}`, `...`, `# existing code`)
- [ ] File `content:` fields are complete — not partial
- [ ] `working_directory` is set on every command step
- [ ] `expected_output` values are literal strings or `EXIT:0` / `EXIT:1`
- [ ] `git_commit.files_to_stage` uses explicit file paths, not globs
- [ ] `metadata.autonomous_executable` is `true` (if any step needs human input, split the task)
- [ ] TDD tasks: failing test step comes before implementation step

---

## Output Directory Convention

```
docs/plans/
  YYYY-MM-DD-<feature-name>/
    README.md               # Index: goal + ordered task list
    task-01-<slug>.yaml
    task-02-<slug>.yaml
    ...
    task-NN-<slug>.yaml
```

Use today's date in `YYYY-MM-DD` format for the directory name.
