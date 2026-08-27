import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

export interface SibylToolResult {
  readonly isError?: boolean | undefined;
  readonly content?:
    readonly { readonly type: string; readonly text?: string | undefined }[] | undefined;
  readonly structuredContent?: Record<string, unknown> | undefined;
}

export interface SibylToolClient {
  call(name: string, arguments_: Readonly<Record<string, unknown>>): Promise<SibylToolResult>;
  close(): Promise<void>;
}

export interface SibylMcpClientOptions {
  readonly command: string;
  readonly timeoutMs?: number;
  readonly args?: readonly string[];
  readonly databasePath?: string;
  readonly credentialsPath?: string;
}

/** Official MCP TypeScript client connected to Sibyl's official stdio server. */
export class SibylMcpToolClient implements SibylToolClient {
  private readonly client = new Client({ name: 'continuity', version: '0.1.0' });
  private readonly transport: StdioClientTransport;
  private connection: Promise<void> | undefined;
  private readonly timeoutMs: number;

  constructor(options: SibylMcpClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    const env = {
      ...getDefaultEnvironment(),
      ...(options.databasePath ? { SIBYL_MEMORY_DB: options.databasePath } : {}),
      ...(options.credentialsPath ? { SIBYL_CREDENTIALS: options.credentialsPath } : {}),
    };
    this.transport = new StdioClientTransport({
      command: options.command,
      ...(options.args ? { args: [...options.args] } : {}),
      env,
      stderr: 'ignore',
    });
  }

  async call(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
  ): Promise<SibylToolResult> {
    await this.connect();
    const result = await this.client.callTool({ name, arguments: { ...arguments_ } }, undefined, {
      timeout: this.timeoutMs,
      maxTotalTimeout: this.timeoutMs,
    });
    return result as SibylToolResult;
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.catch(() => undefined);
      await this.client.close();
      this.connection = undefined;
    }
  }

  private connect(): Promise<void> {
    this.connection ??= this.client.connect(this.transport);
    return this.connection;
  }
}
