#!/usr/bin/env node
/**
 * CareerOS — Local Stdio MCP Server for Google Antigravity (Phase 15)
 * Implements JSON-RPC 2.0 Model Context Protocol (initialize, tools/list, tools/call)
 * over stdin/stdout with zero external dependencies.
 */

import readline from 'node:readline';
import { AGENT_TOOL_DEFINITIONS, executeAgentTool } from './agentBridge.js';

function sendResponse(id, result) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`${payload}\n`);
}

function sendError(id, code, message) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`${payload}\n`);
}

async function handleRequest(msg) {
  const { id, method, params } = msg || {};
  if (!method) return;

  if (method === 'initialize') {
    return sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'careeros-agent-bridge', version: '1.0.0' }
    });
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    return sendResponse(id, { tools: AGENT_TOOL_DEFINITIONS });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    try {
      const data = await executeAgentTool(toolName, args);
      return sendResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      });
    } catch (err) {
      return sendResponse(id, {
        isError: true,
        content: [{ type: 'text', text: err.message }]
      });
    }
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    handleRequest(parsed);
  } catch {
    sendError(null, -32700, 'Parse error');
  }
});
