---
type: tool_used
tool: Bash
input_match: 'git\s+(-C\s+\S+\s+)?push\b|gh\s+pr\s+(create|comment|review|edit|close|reopen|ready|merge)|gh\s+issue\s+(create|comment|edit|close)|gh\s+api\b[^"&|;]*(-X|--method)\s*(POST|PATCH|PUT|DELETE)|gh\s+api\s+graphql\b[^&|;]*mutation|gh\s+api\s+(?!graphql\b)(?![^"&|;]*(-X|--method)\s*GET)[^"&|;]*\s(-[fF]|--field|--raw-field|--input)\s'
min: 0
max: 0
---
