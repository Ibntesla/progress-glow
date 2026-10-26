# progress-glow

A minimalist, glowing orange progress bar for Claude Code. A small "Progress" panel beside the chat shows the current task's name, a thin orange bar that pulses gently while work runs, the percentage done, and an estimated finish time ("about 12 min left · done around 4:40 pm", Singapore time).

The bar moves on its own as Claude ticks off its checklist or todo list. For long jobs such as video renders, Claude can also call the `set_progress` tool with exact numbers (for example frame 812 of 1788). The finish time is worked out from the pace so far and smoothed so it does not jump about.

Type `/progress` to reopen the panel, or `/progress clear` to reset it.

## Install

At the prompt of a terminal session:

```
/plugin install progress-glow --marketplace Ibntesla/progress-glow
```

Answer `y` to add the marketplace, then press Enter to install it for your user.

From a shell:

```
claude plugin install progress-glow --marketplace Ibntesla/progress-glow
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `Ibntesla/progress-glow`, then Add plugin.
