# Neural Link

> "Cloud Brain + Local Hands" - A remote control system for desktop applications

## Project Overview

Neural Link is a cross-platform automation system that enables remote control of desktop applications through a mobile interface. The system consists of three main components:

- **Mobile App**: Controller interface for drafting and confirming actions
- **Cloud Brain**: Intent processing and routing service
- **Desktop Client**: Node.js-based executor with GUI automation capabilities

## Architecture

```
Mobile (Controller)  <--WSS-->  Cloud (Brain)  <--WSS-->  Desktop (Executor)
                                                            |
                                                            +--> Shell Exec
                                                            +--> File IO
                                                            +--> Desktop Bridge (GUI Automation)
                                                                        |
                                                                        +--> WeChat / Slack
                                                                        +--> Browser
```

## Documentation

- [Project Brief](./project-brief.md) - Initial project concept
- [PRD](./prd.md) - Product Requirements Document
- [Architecture](./architecture.md) - System Architecture v1.2
- [User Stories](./user-stories.md) - User story definitions

## Tech Stack

- **Desktop Client**: Node.js with native addons
- **Cloud**: WebSocket Gateway, Intent Planner
- **Mobile**: React Native / Flutter
- **GUI Automation**:
  - Windows: UI Automation API, PowerShell
  - macOS: Accessibility API, AppleScript

## Key Features

- Remote WeChat/Slack messaging from mobile
- File transfer between mobile and desktop
- Draft-to-Action confirmation flow
- Visual audit with screen highlight
- Emergency kill switch

## Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd linkingChat

# Install dependencies
npm install

# Start development
npm run dev
```

## License

MIT
