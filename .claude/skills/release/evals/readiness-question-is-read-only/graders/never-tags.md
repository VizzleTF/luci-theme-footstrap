---
type: tool_used
tool: Bash
input_match: 'git\s+(-C\s+\S+\s+)?tag\s+(-[asfdmFu]|--(annotate|sign|force|delete|message|file|local-user)|v?\d)|git\s+(-C\s+\S+\s+)?update-ref\b[^"&|;]*refs/tags|git\s+(-C\s+\S+\s+)?push\b[^"&|;]*(\s:?v\d+\.\d+|--tags|--follow-tags|refs/tags)|gh\s+release\s+(create|edit|delete|upload)'
min: 0
max: 0
---
