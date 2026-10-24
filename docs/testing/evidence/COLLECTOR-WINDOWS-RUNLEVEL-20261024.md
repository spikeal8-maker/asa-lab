# Collector task RunLevel compatibility — 24 October 2026

## Cause

The installed owned Windows task exports XML without a `RunLevel` element even
though its scheduler principal reports LUA/Limited (numeric zero). Re-registering
the generated explicit `LeastPrivilege` definition produces the same omission.
The previous verifier required explicit text and falsely classified this valid
owned runner as a different/elevated task.

Microsoft's [Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema)
makes RunLevel optional. Its [security-context documentation](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks)
describes low privileges as the default with UAC enabled, and
[Principal.RunLevel](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-runlevel)
defines LUA as zero. This repair verifies the scheduler configuration; it does
not claim to attest effective OS privileges, UAC configuration or account policy.

## Bounded change

The verifier accepts an omitted RunLevel or one leaf element with exact text
`LeastPrivilege`. It rejects elevated/unknown/empty values, duplicates, nested
content and unexpected attributes. It also rejects ambiguous principal containers,
duplicate identity/logon fields and unexpected principal fields, including a
group identity or a differently namespaced RunLevel.

The exact interpreter/pythonw allowance, collector arguments, working directory,
InteractiveToken logon and owner/SID checks remain mandatory. Generated task XML
still requests explicit LeastPrivilege. Nothing changes task registration,
collector data, retention, scheduling, Docker or the running site.

## Verification

One focused local run passed three pure XML tests (0.014 seconds): existing
foreign-action/interpreter/privilege checks; explicit and omitted LUA with all
identity boundaries retained; and 16 malformed/elevated/ambiguous variants.
These fixtures do not register or start any Windows task or service. No live
configuration was changed. Exact-source review and publication are separate
controller steps.
