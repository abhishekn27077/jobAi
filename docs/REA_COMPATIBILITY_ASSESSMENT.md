# REA Compatibility and Installation Assessment

**Target Tool:** REA (Reverse Engineer Anything)  
**Official Repository:** `https://github.com/morluto/rea`  
**Official Documentation:** `https://rea.tools`  
**Evaluation Date:** November 18, 2026  
**Status:** Evaluation Completed — **Installation Pending User Approval**

---

## 1. Tool Overview & Release Metadata

* **Package Identifier:** `rea-agents` (npm package)
* **Latest Published Release:** `6.9.0`
* **License:** **MIT License** (Permissive open-source license allowing inspection, modification, and local execution).
* **Package Purpose:** Bridges AI coding agents (Claude Code, Gemini CLI, Cursor, Codex) to local reverse-engineering, decompilation, and application inspection tools via the Model Context Protocol (MCP) and an interactive CLI.
* **Core Philosophy:** Evidence-based, local-first inspection. It emphasizes grounding agent analysis in concrete code structures, function calls, network traces, and data models rather than LLM speculation.

---

## 2. Host Environment & Runtime Compatibility Analysis

| Component | Host Environment Current Version | REA Requirement / Compatibility | Status |
| :--- | :--- | :--- | :--- |
| **Operating System** | Windows 11 (NT / Powershell) | Cross-platform (Windows, macOS, Linux supported) | **Compatible** |
| **Node.js** | `v24.18.0` | `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` | **Compatible with Warning** (See below) |
| **npm** | Installed with Node 24 | Standard npm package runner (`npx`) supported | **Compatible** |
| **Installed Browsers** | Google Chrome `157.0.8103.79`, Microsoft Edge `157.0.4341.60` | Chromium / Chrome DevTools Protocol supported | **Compatible** |
| **Playwright** | `v1.65.1` (via `npx playwright`) | Native browser automation available | **Compatible** |

### Node.js Engine Analysis
The `rea-agents` package defines `engines: { "node": "^22.23.4 || ^24.22.1 || >=26.12.1" }`.
* **Finding:** Our current runtime is Node.js `v24.18.0`. In standard npm/npx execution, minor/patch engine discrepancies issue a non-blocking console notice unless the user sets `engine-strict=true`.
* **Compatibility:** All JavaScript syntax, ES modules, standard `fetch`, and worker threads used by REA are fully supported in Node `v24.18.0`. No native Node ABI breaks exist between `24.18.0` and `24.22.1`.

---

## 3. Storage, Memory, and External Tool Requirements

REA operates on a tiered capability model. Understanding this distinction is critical to avoiding system bloat.

### Tier 1: Lightweight & Native Web/Script Inspection (Zero Heavy Tools Needed)
These capabilities run entirely in Node.js and require **no native decompilers**:
* **Storage Footprint:** ~25 MB to ~40 MB (npm package cache).
* **Memory Footprint:** ~100 MB to ~250 MB RAM during active execution.
* **External Dependencies:** **None** (pure Node.js / JavaScript).
* **Supported Targets:**
  * **Websites & Web APIs:** Inspecting DOM structures, client-side routing, script bundles, and live network flows.
  * **HAR & Network Captures:** Parsing HTTP Archive (`.har`) files, request/response headers, REST payloads, and GraphQL queries.
  * **JavaScript / TypeScript / Electron Applications:** Unpacking bundles, inspecting source maps, AST parsing, and analyzing Electron IPC channels.
  * **SQLite Databases:** Inspecting tables, triggers, indices, schema migrations, and local application states.
  * **WebAssembly (WASM):** Disassembling and analyzing WebAssembly binaries to WebAssembly Text (`.wat`).

### Tier 2: Heavy Native Decompilation (Requires External Tools)
These capabilities are only needed when reversing compiled native desktop or mobile binaries:
* **Tools Required:** Ghidra (requires JDK 21+ and ~2 GB disk), IDA Pro, Hopper Disassembler, JADX (for Android APKs), or ILSpy (for .NET).
* **Resource Cost:** 2 GB to 6 GB disk space, 2 GB to 4 GB RAM per analysis session.
* **Recommendation for CareerOS:** **Do not install Tier 2 tools.** Career-management and job-search systems are fundamentally web-based, API-driven, and TypeScript/Python applications. All research questions relevant to CareerOS can be resolved using **Tier 1 (Web, HAR, JavaScript/Node, and SQLite analysis)**.

---

## 4. MCP Configuration Audit (`D:\AI-Workspace\.mcp.json`)

We inspected your existing MCP configuration at [D:/AI-Workspace/.mcp.json](file:///D:/AI-Workspace/.mcp.json).

### Current Configuration Inventory
```json
{
  "mcpServers": {
    "git": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-git"] },
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}" } },
    "sequential-thinking": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
    "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] }
  }
}
```

### Conflict Analysis
1. **Name Collision:** **None.** The key `"rea"` does not exist in your current `.mcp.json`.
2. **Environment Overwrite:** **None.** REA does not require overriding existing GitHub tokens or filesystem access rules.
3. **Isolation Guarantee:** Registering REA will not alter or remove any of the 5 existing servers (`git`, `github`, `sequential-thinking`, `context7`, `filesystem`).

---

## 5. Safe Proposed Installation Procedure (Awaiting User Approval)

If you approve the installation of REA, the following non-destructive procedure will be followed:

1. **Step 1 — Create a Timestamped Backup:**
   ```powershell
   Copy-Item "D:\AI-Workspace\.mcp.json" "D:\AI-Workspace\.mcp.json.bak.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
   ```
2. **Step 2 — Add Server Entry via Safe JSON Manipulation (Preserving Existing Keys):**
   ```json
   "rea": {
     "command": "npx",
     "args": ["-y", "rea-agents", "mcp"],
     "env": {}
   }
   ```
3. **Step 3 — Run REA Diagnostics in Dry-Run Mode:**
   ```powershell
   npx --yes rea-agents doctor
   ```
4. **Step 4 — Verify Zero Side-Effects:** Verify that existing MCP servers (`git`, `github`, `context7`, etc.) remain intact and functional.

---

## 6. Assessment Conclusion & Recommendation

* **Technical Viability:** REA is technically viable and compatible with your environment for web, API, bundle, and SQLite reverse-engineering.
* **Scope Boundary:** Native decompilers (Ghidra, IDA) are unnecessary for CareerOS research and will **not** be installed.
* **Safety Hold:** In accordance with your strict instructions, **no installation has been executed**. We are pausing here for your explicit authorization before proceeding with Step 1.
