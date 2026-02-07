# Development Environment Setup Guide

Complete guide to setting up your development environment for the SuperMemory Clone project.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Development Tools](#development-tools)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Troubleshooting](#troubleshooting)
- [IDE Setup](#ide-setup)

## Prerequisites

### Required Software

1. **Node.js** (v20.0.0 or higher)
   ```bash
   node --version  # Should be >= 20.0.0
   ```

2. **npm** (v9.0.0 or higher)
   ```bash
   npm --version   # Should be >= 9.0.0
   ```

3. **Git**
   ```bash
   git --version
   ```

### Installation Methods

#### macOS (using Homebrew)
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js (includes npm)
brew install node@20

# Or use asdf version manager (recommended for managing multiple versions)
brew install asdf
asdf plugin add nodejs
asdf install nodejs 20.11.0
asdf global nodejs 20.11.0
```

#### Linux
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Or use asdf
git clone https://github.com/asdf-vm/asdf.git ~/.asdf
echo '. "$HOME/.asdf/asdf.sh"' >> ~/.bashrc
asdf plugin add nodejs
asdf install nodejs 20.11.0
asdf global nodejs 20.11.0
```

#### Windows
- Download and install from [nodejs.org](https://nodejs.org/)
- Or use [nvm-windows](https://github.com/coreybutler/nvm-windows)

## Initial Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd supermemory-clone
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including:
- Runtime dependencies (Hono, Drizzle ORM, OpenAI SDK, etc.)
- Development dependencies (TypeScript, Vitest, ESLint, Prettier, etc.)

**Expected output:**
```
added 391 packages, and audited 392 packages in 15s
```

### 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure the required variables:

```bash
# Required: OpenAI API Key (for embeddings)
OPENAI_API_KEY=sk-your-openai-api-key-here

# Optional: Anthropic API Key (for LLM-based memory extraction)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here

# Optional: API authentication (leave empty for MCP mode)
AUTH_TOKEN=your-secret-key-here

# Optional: Server configuration
API_PORT=3000
API_HOST=localhost

# Optional: Database path (defaults to ./data/supermemory.db)
DATABASE_URL=./data/supermemory.db
```

#### Getting API Keys

**OpenAI API Key:**
1. Visit [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create new secret key
5. Copy and paste into `.env`

**Anthropic API Key (Optional):**
1. Visit [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Generate API key
4. Copy and paste into `.env`

### 4. Verify TypeScript Configuration

```bash
npm run typecheck
```

**Expected output:**
```
> supermemory-clone@1.0.0 typecheck
> tsc --noEmit
```

No errors should appear. If you see errors, check that:
- All dependencies are installed
- TypeScript version is 5.7.0 or higher
- tsconfig.json is properly configured

## Development Tools

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Build for production |
| `npm start` | Run production build |
| `npm run mcp:dev` | Run MCP server in development mode |
| `npm run mcp` | Run MCP server (production) |
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:ui` | Open Vitest UI |
| `npm run typecheck` | Check TypeScript types |
| `npm run lint` | Lint code with ESLint |
| `npm run lint:fix` | Fix linting issues automatically |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check code formatting |
| `npm run validate` | Run all checks (type, lint, format, test) |
| `npm run clean` | Remove build artifacts |

### Hot-Reload Development

Start the development server with automatic reloading:

```bash
npm run dev
```

This will:
- Watch for file changes in `src/`
- Automatically restart on changes
- Show compilation errors in the terminal
- Use `tsx` for fast TypeScript execution

**Expected output:**
```
Server running on http://localhost:3000
Watching for file changes...
```

### Production Build

Build the optimized production bundle:

```bash
npm run build
```

This will:
- Compile TypeScript to JavaScript
- Generate type declarations
- Output to `dist/` directory
- Create source maps

**Output structure:**
```
dist/
├── index.js
├── index.d.ts
├── mcp/
│   ├── index.js
│   └── index.d.ts
└── ... (other compiled files)
```

Run the production build:
```bash
npm start
```

## Database Setup

### Initialize Database

The project uses SQLite with Drizzle ORM. Set up the database:

#### 1. Create Data Directory

```bash
mkdir -p data
```

#### 2. Generate Migration Files

```bash
npm run db:generate
```

**Expected output:**
```
9 tables
api_usage 8 columns 3 indexes 1 fks
chunks 9 columns 2 indexes 1 fks
embeddings 6 columns 1 indexes 1 fks
memories 11 columns 4 indexes 2 fks
memory_tags 3 columns 2 indexes 2 fks
search_history 5 columns 2 indexes 1 fks
spaces 7 columns 1 indexes 1 fks
tags 5 columns 2 indexes 1 fks
users 6 columns 4 indexes 0 fks

[✓] Your SQL migration file ➜ drizzle/0000_*.sql 🚀
```

#### 3. Apply Migrations

```bash
npm run db:migrate
```

Or use push for development (auto-applies schema changes):
```bash
npm run db:push
```

#### 4. Verify Database

Check that the database file was created:

```bash
ls -lh data/
```

**Expected output:**
```
-rw-r--r-- 1 user group 4.0K Feb 2 08:00 supermemory.db
```

### Database Studio (GUI)

Launch Drizzle Studio for visual database management:

```bash
npm run db:studio
```

This opens a web UI at `https://local.drizzle.studio` where you can:
- View tables and data
- Run queries
- Inspect schema
- Edit records

### Database Schema Overview

The database includes these tables:

| Table | Purpose |
|-------|---------|
| `users` | User accounts and API keys |
| `spaces` | Collections/folders for organizing memories |
| `memories` | Main content storage |
| `chunks` | Split content for RAG |
| `embeddings` | Vector embeddings for semantic search |
| `tags` | User-defined tags |
| `memory_tags` | Many-to-many relationship |
| `search_history` | Analytics and search tracking |
| `api_usage` | API usage metrics |

## Running the Application

### Development Mode (API Server)

```bash
npm run dev
```

The server starts on `http://localhost:3000` (configurable via `API_PORT`).

**Test the server:**
```bash
# Health check
curl http://localhost:3000/health

# Expected: {"status":"ok","timestamp":"2026-02-02T08:00:00.000Z"}
```

### MCP Server Mode

For Model Context Protocol integration:

```bash
npm run mcp:dev
```

This starts the MCP server using stdio transport. Configure in Claude Desktop:

```json
{
  "mcpServers": {
    "supermemory": {
      "command": "node",
      "args": ["/path/to/supermemory-clone/dist/mcp/index.js"]
    }
  }
}
```

### Docker Development

Use Docker Compose for isolated development:

```bash
# Development with hot-reload
docker-compose -f docker-compose.dev.yml up

# Production mode
docker-compose -f docker-compose.prod.yml up

# Full stack (with ChromaDB, Redis, PostgreSQL)
docker-compose up
```

## Testing

### Test Suite Overview

The project uses Vitest for testing with comprehensive coverage:

- **340+ test cases** across all components
- **80%+ code coverage** requirement
- Unit, integration, and API tests
- Isolated test environment

### Running Tests

#### Watch Mode (Interactive)
```bash
npm test
```

This runs tests in watch mode, automatically re-running when files change.

#### Run Once (CI Mode)
```bash
npm run test:run
```

#### Coverage Report
```bash
npm run test:coverage
```

**Expected output:**
```
Test Files  20 passed (20)
     Tests  340 passed (340)
  Start at  08:00:00
  Duration  15.32s

File                       | % Stmts | % Branch | % Funcs | % Lines |
---------------------------|---------|----------|---------|---------|
All files                  |   85.23 |    78.45 |   82.11 |   85.67 |
 src/api                   |   92.15 |    85.32 |   88.76 |   92.43 |
 src/services              |   81.34 |    75.22 |   79.54 |   81.87 |
 src/mcp                   |   88.92 |    82.14 |   85.33 |   89.21 |
```

Coverage reports are also generated in HTML format: `coverage/index.html`

#### UI Mode (Visual Testing)
```bash
npm run test:ui
```

Opens an interactive UI at `http://localhost:51204` for:
- Running individual tests
- Viewing test results
- Debugging failures
- Monitoring coverage

### Test Structure

```
tests/
├── setup.ts                    # Global test configuration
├── api/                        # API endpoint tests
│   ├── documents.test.ts
│   ├── search.test.ts
│   └── middleware/
├── services/                   # Service layer tests
│   ├── chunking.service.test.ts
│   ├── extraction.service.test.ts
│   └── search.service.test.ts
├── sdk/                        # SDK client tests
│   └── resources/
└── mcp/                        # MCP server tests
    └── mcp.test.ts
```

### Writing Tests

Follow the established patterns:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('MyService', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  describe('myMethod', () => {
    it('should handle valid input', () => {
      const result = myService.myMethod('valid');
      expect(result).toBeDefined();
    });

    it('should throw on invalid input', () => {
      expect(() => myService.myMethod(null)).toThrow();
    });
  });
});
```

### Coverage Thresholds

The project enforces minimum coverage thresholds:

```typescript
// vitest.config.ts
thresholds: {
  statements: 80,
  branches: 75,
  functions: 80,
  lines: 80,
}
```

Tests will fail if coverage drops below these levels.

## Code Quality

### Linting with ESLint

Check code for issues:

```bash
npm run lint
```

Automatically fix issues:

```bash
npm run lint:fix
```

**Common issues:**
- Unused variables (use `_` prefix for intentionally unused)
- Missing return types (optional, but recommended)
- Floating promises (always await or handle)
- Console logs (use logger instead)

### Formatting with Prettier

Check formatting:

```bash
npm run format:check
```

Auto-format all files:

```bash
npm run format
```

**Prettier rules:**
- Single quotes for strings
- Semicolons required
- 100 character line width
- 2 space indentation
- Trailing commas in ES5

### Pre-commit Validation

Run all checks before committing:

```bash
npm run validate
```

This runs:
1. TypeScript type checking
2. ESLint linting
3. Prettier formatting check
4. Full test suite

**Expected to pass before committing code.**

### Editor Integration

#### VS Code

Install recommended extensions:
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- TypeScript (`ms-vscode.vscode-typescript-next`)

Configure settings.json:
```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

#### JetBrains IDEs (WebStorm, IntelliJ IDEA)

1. Enable ESLint: Settings → Languages → JavaScript → Code Quality Tools → ESLint
2. Enable Prettier: Settings → Languages → JavaScript → Prettier
3. Enable format on save: Settings → Tools → Actions on Save

## Troubleshooting

### Common Issues

#### 1. `ENOENT: no such file or directory, open '.env'`

**Solution:**
```bash
cp .env.example .env
# Then edit .env with your values
```

#### 2. `Cannot find module '@/*' or its corresponding type declarations`

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Verify tsconfig.json has proper paths
npm run typecheck
```

#### 3. Database Migration Errors

**Solution:**
```bash
# Remove existing database
rm -rf data/*.db

# Regenerate migrations
npm run db:generate

# Apply migrations
npm run db:migrate
```

#### 4. TypeScript Compilation Errors

**Solution:**
```bash
# Clean build artifacts
npm run clean

# Reinstall TypeScript
npm install --save-dev typescript@latest

# Rebuild
npm run build
```

#### 5. Test Failures

**Solution:**
```bash
# Clear test cache
rm -rf node_modules/.vitest

# Run tests with verbose output
npm run test:run -- --reporter=verbose

# Check specific failing test
npm run test:run -- tests/path/to/test.test.ts
```

#### 6. Port Already in Use

**Solution:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use different port
API_PORT=3001 npm run dev
```

#### 7. OpenAI API Errors

**Solution:**
```bash
# Verify API key is set
echo $OPENAI_API_KEY

# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check usage limits at platform.openai.com
```

#### 8. SQLite Version Issues

**Solution:**
```bash
# Rebuild better-sqlite3
npm rebuild better-sqlite3

# Or reinstall
npm uninstall better-sqlite3
npm install better-sqlite3
```

### Debugging

#### Enable Debug Logging

```bash
LOG_LEVEL=debug npm run dev
```

#### Use Node.js Debugger

Add `--inspect` flag:
```bash
node --inspect dist/index.js
```

Or use VS Code launch configuration:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug App",
  "runtimeArgs": ["-r", "tsx"],
  "args": ["src/index.ts"],
  "console": "integratedTerminal"
}
```

#### Test Debugging

Run specific test with debugger:
```bash
npm run test:run -- --inspect-brk tests/path/to/test.test.ts
```

### Getting Help

1. Check existing issues on GitHub
2. Review API documentation in `docs/api.md`
3. Check Claude MCP documentation
4. Search error messages in issues

## IDE Setup

### Recommended VS Code Extensions

Install workspace recommendations:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-next",
    "vitest.explorer",
    "bradlc.vscode-tailwindcss"
  ]
}
```

### Workspace Settings

Create `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "files.exclude": {
    "**/.git": true,
    "**/node_modules": true,
    "**/dist": true,
    "**/coverage": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/dist": true,
    "**/coverage": true
  }
}
```

### Launch Configurations

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Dev Server",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["-r", "tsx"],
      "args": ["src/index.ts"],
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "name": "Debug MCP Server",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["-r", "tsx"],
      "args": ["src/mcp/index.ts"],
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${file}"],
      "console": "integratedTerminal"
    }
  ]
}
```

## Next Steps

After completing setup:

1. **Read the API Documentation**: `docs/api.md`
2. **Explore the Codebase**: Start with `src/index.ts`
3. **Run the Test Suite**: `npm test`
4. **Try the MCP Integration**: Follow `docs/mcp.md`
5. **Build a Feature**: Check `BACKLOG.md` for ideas

## Verification Checklist

Use this checklist to verify your setup:

- [ ] Node.js v20+ installed
- [ ] npm v9+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] Environment variables configured (`.env`)
- [ ] OpenAI API key set (or using mock mode)
- [ ] Database migrations applied (`npm run db:migrate`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Tests pass (`npm run test:run`)
- [ ] Linting passes (`npm run lint`)
- [ ] Formatting passes (`npm run format:check`)
- [ ] Dev server starts (`npm run dev`)
- [ ] Database studio accessible (`npm run db:studio`)
- [ ] IDE configured with recommended extensions
- [ ] Git configured and ready to commit

## Summary

You now have a fully configured development environment with:

- TypeScript with strict type checking
- Automated testing with Vitest (340+ tests)
- Code quality tools (ESLint + Prettier)
- Hot-reload development server
- Database management with Drizzle ORM
- MCP server integration
- Docker support for isolated environments
- Comprehensive documentation

Happy coding! 🚀
