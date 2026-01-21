# DayTrader

A day trading application.

## Getting Started

### Prerequisites

- Configure environment variables (see `.env.example`)

### Installation

1. Clone the repository
2. Copy `.env.example` to `.env` and configure your settings
3. Follow build instructions (to be added as the project develops)

## Configuration

All configuration is managed through environment variables. See `.env.example` for required variables and their descriptions.

## Build Info

Build information (version, commit, build time) will be visible in the application once the main codebase is implemented.

## Development

### Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `ci:` - CI/CD changes
- `build:` - Build system changes

Breaking changes should be marked with `!` (e.g., `feat!:`) or include `BREAKING CHANGE` in the commit body.

## Security

- Never commit secrets or credentials
- All data access is tenant-scoped for multi-tenant isolation
- Input validation and safe error handling are required

## License

See LICENSE file for details.
