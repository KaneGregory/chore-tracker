## Purpose
To help the members of a household to manage chores.

## Architectural decisions
* Two components:
* 1) A backend that records chore info for households.
* 2) A web interface for individual users.
* UI will be built using React.
* UI must be installable as App on multiple individuals' phones (Android).

## All code should be

1) Correct
2) Clear
3) Maintainable

## Dos and Do Nots

Do:
* Break views down into logical components.
* Use reducers and context to share app state.
* Update this file with new dos and do nots based on architectural decisions.
* Ask who will verify each change (you, the user, or someone else), rather than wasting tokens on verification the user could do themselves.
* Add frequently-used shell commands (typechecking, verification, etc.) as `package.json` scripts instead of retyping them each time.

Do not:
* Add multiple components to a single file.
* Comment code except when describing why something had to be done in a non-obvious way.

## Post-change review workflow

After any code change is complete (before considering the task done), review the
change in three separate passes. Do not combine these into a single pass — each is
dedicated to one concern so it gets full attention:

1. **Correctness pass.** Re-read the diff and ask: does this actually do what it's
   supposed to do? Check logic, edge cases, error handling, and that tests (if any)
   genuinely exercise the change rather than just asserting it didn't crash.
2. **Architecture pass.** Re-read the diff again, this time for structure: does it fit
   the existing patterns in the codebase, is it in the right place, is there
   unnecessary duplication or an abstraction that should be reused instead, is
   anything over- or under-engineered for what was asked.
3. **Security pass.** Re-read the diff a third time specifically for security issues:
   injection (SQL, command, prompt), unsanitized input crossing a trust boundary,
   secrets or credentials handled unsafely, path traversal, and similar OWASP-style
   concerns.

Each pass should be a distinct read-through of the change with that pass's question in
mind — not a single review that tries to think about all three at once.