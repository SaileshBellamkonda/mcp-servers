# Atomic Task YAML Schema Template

## Complete Schema

```yaml
# Unique identifier for this task (kebab-case)
task_id: string

# Human-readable task name
task_name: string

# List of task IDs that must complete before this task
depends_on: [string]  # Empty array [] if no dependencies

# Conditions that must be true before starting — verified before any implementation step runs
preconditions:
  - condition: string  # Measurable entry state requirement
    verification_command: string  # Exact command to verify condition
    expected_result: string  # Expected output or exit state

# Environment requirements
environment:
  required_tools:
    - tool: string  # e.g., "node"
      version: string  # e.g., "22.13.0+"
      check_command: string  # e.g., "node --version"
  environment_variables:
    - name: string
      value: string
      required: boolean

# Deterministic step-by-step implementation instructions
implementation_steps:
  - step_number: integer
    description: string  # Brief description of what this step does
    action_type: string  # "command" | "file_create" | "file_modify" | "file_copy"

    # For command actions
    command: string  # Exact shell command with full arguments
    working_directory: string  # Directory to execute command in

    # For file operations
    file_path: string  # Complete absolute or relative path
    operation: string  # "create" | "modify" | "copy" | "delete"
    content: string  # Complete file content (for create/modify)
    source_path: string  # Source file path (for copy)

    # Inline validation checkpoint — runs immediately after this step
    validation_checkpoint:
      description: string
      command: string  # Verification command
      expected_output: string  # Exact or pattern match
      on_failure:
        action: string  # "stop" | "retry" | "rollback"
        max_retries: integer

# Verification steps executed after all implementation_steps complete, before postconditions
validation_steps:
  - step_number: integer
    description: string  # What is being validated
    command: string  # Exact verification command
    expected_output: string  # Exact or pattern match
    on_failure:
      action: string  # "stop" | "rollback"
      rollback_ref: string  # Key from rollback_procedures to execute

# Rollback and recovery procedures for each failure state
rollback_procedures:
  - failure_state: string  # Specific failure condition
    detection_command: string  # Programmatic failure detection
    detection_pattern: string  # Pattern to match in output
    recovery_steps:
      - step_number: integer
        action: string  # Exact reversion command
        verification: string  # Command to verify recovery step

# System state assertions that must be true after implementation and validation complete
postconditions:
  - assertion: string  # Measurable postcondition
    verification_command: string  # Exact verification command
    expected_result: string

# Git commit specifications
git_commit:
  enabled: boolean  # Whether to commit after this task
  message_template: string  # Exact commit message
  files_to_stage: [string]  # Complete file paths (explicit, not glob patterns)
  pre_commit_checks:
    - check: string
      command: string
      expected_result: string

# Traceability
traceability:
  original_requirement: string  # Link to original milestone requirement
  acceptance_criteria: [string]  # List of acceptance criteria from original plan

# Metadata
metadata:
  complexity: string  # "simple" | "moderate" | "complex"
  idempotent: boolean  # Can this task be safely retried?
  autonomous_executable: boolean  # Can AI agent execute without human intervention?
```

## Minimal Required Fields

For tasks that don't need all fields, the minimum required schema is:

```yaml
task_id: string
task_name: string
depends_on: []
preconditions: []
implementation_steps:
  - step_number: 1
    action_type: string
    command: string
    validation_checkpoint:
      command: string
      expected_output: string
validation_steps:
  - step_number: 1
    description: string
    command: string
    expected_output: string
rollback_procedures: []
postconditions: []
git_commit:
  enabled: boolean
traceability:
  original_requirement: string
metadata:
  autonomous_executable: boolean
```

## Field Descriptions

### task_id
Unique identifier using kebab-case. Format: `<plan-slug>-<NN>-<action-slug>` (e.g. `git-clone-01-write-test`)

### depends_on
Array of task_ids that must complete successfully before this task can start. Use empty array `[]` if no dependencies.

### preconditions
Conditions that must be true before any implementation step runs. Each includes:
- `condition`: Human-readable description
- `verification_command`: Exact command to check the condition
- `expected_result`: What the verification should return

### implementation_steps
Sequential operations to complete the task. Each step includes:
- `action_type`: Type of operation (`command`, `file_create`, `file_modify`, `file_copy`)
- `command`: Exact shell command (for command actions)
- `file_path`: Path to file (for file operations)
- `validation_checkpoint`: Immediate verification after the step; `on_failure.action` is `"stop"`, `"retry"`, or `"rollback"`

### validation_steps
Verification steps executed after all `implementation_steps` complete and before `postconditions` are checked. Each step includes:
- `description`: What is being validated
- `command`: Exact verification command
- `expected_output`: Exact or pattern match for the command output
- `on_failure.action`: `"stop"` or `"rollback"`; `rollback_ref` names the entry in `rollback_procedures` to execute

### rollback_procedures
What to do if something fails:
- `failure_state`: Description of the failure
- `detection_command`: How to detect this failure programmatically
- `recovery_steps`: Exact steps to undo changes

### postconditions
Measurable system state assertions that must be true after `validation_steps` complete. Each includes:
- `assertion`: Human-readable description
- `verification_command`: Exact verification command
- `expected_result`: What the verification should return

### git_commit
Whether and how to commit:
- `enabled`: true/false
- `message_template`: Exact commit message
- `files_to_stage`: Explicit list of files (no globs like `*` or `.`)

## Example: Complete Task File

```yaml
task_id: m8a-ticket-creation-01-package-json
task_name: Update ticket-creation-agent package.json
depends_on: []

preconditions:
  - condition: Package directory exists
    verification_command: test -d packages/ticket-creation-agent
    expected_result: exit code 0
  - condition: pnpm is installed
    verification_command: pnpm --version
    expected_result: version string matching 9.0.0+

environment:
  required_tools:
    - tool: pnpm
      version: 9.0.0+
      check_command: pnpm --version

implementation_steps:
  - step_number: 1
    description: Create or update package.json with exact dependencies
    action_type: file_create
    file_path: packages/ticket-creation-agent/package.json
    content: |
      {
        "name": "@agenticops/ticket-creation-agent",
        "version": "0.0.1",
        "private": true,
        "type": "module",
        "scripts": {
          "build": "tsc",
          "dev": "tsc --watch",
          "start": "node dist/server.js",
          "clean": "rm -rf dist",
          "test": "vitest run"
        },
        "dependencies": {
          "@agenticops/shared": "workspace:*",
          "@mastra/core": "^1.25.0",
          "hono": "^4.7.0",
          "@hono/node-server": "^1.13.0",
          "nats": "^2.28.0",
          "pg": "^8.13.0",
          "zod": "^3.23.0"
        },
        "devDependencies": {
          "typescript": "^5.7.0",
          "vitest": "^3.2.0",
          "@types/pg": "^8.11.0",
          "@types/node": "^22.0.0"
        }
      }
    validation_checkpoint:
      description: Verify package.json is valid JSON
      command: node -e "JSON.parse(require('fs').readFileSync('packages/ticket-creation-agent/package.json', 'utf8'))"
      expected_output: no error
      on_failure:
        action: stop

validation_steps:
  - step_number: 1
    description: Verify package.json exists at expected path
    command: test -f packages/ticket-creation-agent/package.json
    expected_output: exit code 0
    on_failure:
      action: stop
  - step_number: 2
    description: Verify package name is correct
    command: node -e "const pkg = JSON.parse(require('fs').readFileSync('packages/ticket-creation-agent/package.json', 'utf8')); process.exit(pkg.name === '@agenticops/ticket-creation-agent' ? 0 : 1)"
    expected_output: exit code 0
    on_failure:
      action: rollback
      rollback_ref: invalid-package-json

rollback_procedures:
  - failure_state: invalid-package-json
    detection_command: node -e "JSON.parse(require('fs').readFileSync('packages/ticket-creation-agent/package.json', 'utf8'))"
    detection_pattern: SyntaxError
    recovery_steps:
      - step_number: 1
        action: git restore packages/ticket-creation-agent/package.json
        verification: git status --porcelain packages/ticket-creation-agent/package.json

postconditions:
  - assertion: package.json exists and is valid JSON
    verification_command: node -e "JSON.parse(require('fs').readFileSync('packages/ticket-creation-agent/package.json', 'utf8'))"
    expected_result: exit code 0
  - assertion: package.json has correct name field
    verification_command: node -e "const pkg = JSON.parse(require('fs').readFileSync('packages/ticket-creation-agent/package.json', 'utf8')); process.exit(pkg.name === '@agenticops/ticket-creation-agent' ? 0 : 1)"
    expected_result: exit code 0

git_commit:
  enabled: false
  message_template: ""
  files_to_stage: []

traceability:
  original_requirement: "M8A Task 1 Step 1: Update packages/ticket-creation-agent/package.json"
  acceptance_criteria:
    - package.json exists
    - package.json is valid JSON
    - package.json has correct name and dependencies

metadata:
  complexity: simple
  idempotent: true
  autonomous_executable: true
```
