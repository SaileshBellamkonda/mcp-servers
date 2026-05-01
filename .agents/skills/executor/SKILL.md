---
name: executor
description: "Use when you need to execute an implementation plan made of atomic YAML task files. Use for: running tasks from docs/plans/; executing a single task YAML file; resuming a stopped plan; retrying a failed task. Reads YAML-SCHEMA task files produced by the planner skill and executes them step-by-step with validation and rollback. Does NOT create plans — execution only."
argument-hint: "Path to a plan directory or a single task YAML file (e.g. 'docs/plans/2026-05-01-git-clone/')"
---

# Executor Skill

## Purpose

Execute atomic YAML task files produced by the planner skill. Run each task step-by-step, validate results, handle failures, and commit when instructed.

**Announce at start:** "I'm using the executor skill to run the plan."

**YAML-SCHEMA reference:** [./YAML-SCHEMA.md](./YAML-SCHEMA.md) — read this to understand the structure of task files before executing.

---

## Execution Process

### Step 0 — Locate the Plan

Determine what to execute:

1. If the user provides a directory path (e.g. `docs/plans/2026-05-01-git-clone/`):
   - Read `README.md` in that directory to get the ordered task list.
   - Execute tasks in the listed order.
2. If the user provides a single YAML file path:
   - Execute that file only.
3. If neither is provided:
   - List directories under `docs/plans/` and ask the user to pick one.

### Step 1 — Read the Task File

For each task file:
- Parse the YAML.
- Read `task_name`, `task_id`, and `depends_on`.
- Confirm all tasks listed in `depends_on` have already been completed before proceeding. If not, stop and inform the user.

### Step 2 — Verify Preconditions

For each item in `preconditions`:
1. Run `verification_command`.
2. Check output matches `expected_result`.
3. If any precondition fails → **stop** and report which condition failed and why.

Do not proceed to implementation steps until all preconditions pass.

### Step 3 — Verify Environment

For each tool in `environment.required_tools`:
1. Run `check_command`.
2. Confirm the version meets the requirement.
3. If missing or wrong version → **stop** and report.

For each entry in `environment.environment_variables` where `required: true`:
1. Check the variable is set in the environment.
2. If missing → **stop** and report.

### Step 4 — Execute Implementation Steps

For each step in `implementation_steps` (in `step_number` order):

#### Determine action type

| `action_type` | What to do |
|---------------|------------|
| `command` | Run `command` in `working_directory` |
| `file_create` | Create the file at `file_path` with `content` |
| `file_modify` | Overwrite the file at `file_path` with `content` |
| `file_copy` | Copy `source_path` to `file_path` |

#### After each step — run `validation_checkpoint`

1. Run `validation_checkpoint.command`.
2. Compare output to `validation_checkpoint.expected_output`.
3. On mismatch, apply `on_failure.action`:
   - `stop` → halt immediately, report the step number and actual output.
   - `retry` → retry up to `max_retries` times, then stop if still failing.
   - `rollback` → run the rollback procedure matching the failure, then stop.

**Never skip a `validation_checkpoint`.** If the field is absent in a task, treat it as a bug in the plan and stop.

### Step 5 — Run Validation Steps

After all `implementation_steps` complete, run each item in `validation_steps` (in `step_number` order):

1. Run `command`.
2. Compare output to `expected_output`.
3. On mismatch, apply `on_failure.action`:
   - `stop` → halt and report.
   - `rollback` → look up `rollback_ref` in `rollback_procedures`, execute recovery steps, then stop.

### Step 6 — Check Postconditions

For each item in `postconditions`:
1. Run `verification_command`.
2. Compare output to `expected_result`.
3. If any postcondition fails → stop and report.

All postconditions must pass before the task is considered complete.

### Step 7 — Test-Driven-Development (TDD) Enforcement for Test Tasks

When executing a task whose purpose is to write a test (identifiable by `task_id` ending in `-write-test`, `-test`, or any task whose description mentions "failing test"):

1. **After the test file is created**, run the test immediately.
2. **Assert the test FAILS** — if it passes, stop and report: the test is not verifying new behavior.
3. **Record the failure message** — confirm it says the feature is missing, not a syntax error.
4. Only then advance to the implementation task.

```
TDD RED Gate: test must FAIL before implementation is allowed to proceed.
```

When executing an implementation task that follows a test task:

1. Run the implementation step(s).
2. **Run the test again** — assert it now **PASSES**.
3. Run the full test suite — assert no regressions.
4. Only then mark the implementation task complete.

```
TDD GREEN Gate: test must PASS after implementation before the task is complete.
```

Never skip either gate. A task marked complete without both gates verified is incomplete.

### Step 8 — Verification Before Completion

**Iron Law:**

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Before marking ANY task complete, you must:

1. **IDENTIFY** — What command proves this task is done?
2. **RUN** — Execute that command fresh (not from memory or a previous run).
3. **READ** — Check the full output and exit code.
4. **VERIFY** — Does the output confirm the claim?
   - If NO: state actual status with evidence, stop.
   - If YES: state the claim WITH the evidence.
5. **ONLY THEN** — Mark the task complete.

Red flags — stop immediately if you catch yourself:

- Using "should", "probably", "seems to"
- Expressing satisfaction before running verification ("Done!", "That's it!", "Looks good!")
- About to commit without running the test suite
- Trusting a previous run's output as current evidence

**Verification minimum per task:**

| Claim | Required evidence |
|-------|-------------------|
| Tests pass | Test command output showing 0 failures |
| Build succeeds | Build command exit code 0 |
| File created | Existence check command output |
| Git commit created | `git log --oneline -1` output |
| Task complete | All postconditions verified with commands |

### Step 9 — Commit (if enabled)

If `git_commit.enabled` is `true`:

1. Run each check in `git_commit.pre_commit_checks`. Stop if any fail.
2. Stage only the files listed in `git_commit.files_to_stage` — run:
   ```
   git add <file1> <file2> ...
   ```
   Never use `git add .` or `git add -A`.
3. Commit with the exact message in `git_commit.message_template`:
   ```
   git commit -m "<message_template>"
   ```
4. Confirm the commit was created (`git log --oneline -1`).

### Step 10 — Advance to Next Task

Mark the task as complete and move to the next task file in the plan order.

---

## Failure Handling

### When to Stop

Stop and report (do not attempt to continue) when:
- A precondition fails.
- An environment check fails.
- A `validation_checkpoint` fires with `action: stop` after exhausting retries.
- A `validation_step` fires with `action: stop`.
- A postcondition fails.
- A rollback procedure fails.

### Running a Rollback

When `action: rollback` is triggered:
1. Find the entry in `rollback_procedures` where `failure_state` matches the current failure (or use `rollback_ref` from `validation_steps`).
2. Execute each `recovery_step.action` in order.
3. After each recovery step, run `recovery_step.verification` and confirm it succeeds.
4. After rollback completes, **stop** — do not continue the task.
5. Report: which step failed, what was rolled back, and the current state.

### Reporting a Failure

When stopping due to a failure, always report:
- **Task ID** and **task name**
- **Step number** that failed
- **Command** that was run
- **Actual output** received
- **Expected output** that was required
- **Action taken** (stopped / rolled back)
- **Suggested next step** for the user (fix the condition, re-run the task, or skip)

---

## Resuming a Plan

If a plan was previously stopped partway through:
1. Ask the user which task to resume from.
2. Confirm the `depends_on` tasks for that task are complete.
3. Check preconditions again before resuming.
4. If the task is marked `idempotent: true`, it is safe to re-run from the beginning.
5. If `idempotent: false`, warn the user that re-running may cause side effects.

---

## Execution Checklist

Before marking any task complete, confirm:

- [ ] All `preconditions` passed
- [ ] All `environment` checks passed
- [ ] All `implementation_steps` ran with passing `validation_checkpoint`s
- [ ] All `validation_steps` passed
- [ ] All `postconditions` passed
- [ ] **TDD RED gate**: test task confirmed to FAIL before implementation
- [ ] **TDD GREEN gate**: test confirmed to PASS after implementation
- [ ] **Verification**: completion claim backed by fresh command output (not assumption)
- [ ] If `git_commit.enabled: true` — commit was created with the exact message and only the listed files

---

## Progress Reporting

After each task completes, print a one-line status:

```
✓ [task-id] task_name — COMPLETE
```

After all tasks in a plan complete:

```
Plan complete. All N tasks passed.
```

If a task fails:

```
✗ [task-id] task_name — FAILED at step N: <short description>
```
