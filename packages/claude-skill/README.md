# @financedistrict/saleor-agentic-commerce-skill

Claude Code plugin for the [Saleor Agentic Commerce SDK](https://github.com/financedistrict-platform/saleor-agentic-commerce). Gives Claude the knowledge to install, configure, and troubleshoot the SDK in any Saleor storefront.

## Skills

| Slash Command | What it does |
|---------------|-------------|
| `/setup-agentic-commerce` | Full guided setup — installs packages, creates route handlers, configures env vars |
| `/add-payment-handler` | Adds Prism stablecoin payments (or other handlers) to an existing setup |
| `/diagnose-agentic-commerce` | Runs diagnostics on an existing setup — checks packages, config, routes, env vars |

## Install

### Option 1: Add to your project

Copy the `skills/` directory into your project:

```
.claude/skills/
├── setup-agentic-commerce/
│   └── SKILL.md
├── add-payment-handler/
│   └── SKILL.md
└── diagnose-agentic-commerce/
    └── SKILL.md
```

### Option 2: Personal skills (all projects)

Copy to your home directory:

```bash
cp -r skills/* ~/.claude/skills/
```

### Option 3: As a Claude Code plugin

Add to your Claude Code settings:

```json
{
  "plugins": [
    "@financedistrict/saleor-agentic-commerce-skill"
  ]
}
```

## Usage

Open Claude Code in your Saleor storefront project and type:

```
/setup-agentic-commerce
```

Claude will:
1. Detect your project structure (Next.js version, App Router, package manager)
2. Install the SDK packages
3. Create the agentic-commerce config file
4. Create all UCP route handlers
5. Set up environment variables
6. Verify the setup works

After setup, add payments:

```
/add-payment-handler prism
```

If something breaks:

```
/diagnose-agentic-commerce
```

## What gets created

```
src/
├── lib/
│   └── agentic-commerce.ts          # SDK instance configuration
└── app/
    └── api/
        └── ucp/
            ├── route.ts              # GET  /api/ucp (discovery)
            ├── checkout/
            │   ├── route.ts          # POST /api/ucp/checkout
            │   └── [id]/
            │       ├── route.ts      # GET  /api/ucp/checkout/:id
            │       └── complete/
            │           └── route.ts  # POST /api/ucp/checkout/:id/complete
            └── orders/
                └── [id]/
                    └── route.ts      # GET  /api/ucp/orders/:id
```

## License

MIT
