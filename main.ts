import { PyodideRuntimeAgent } from "@runt/pyodide-runtime-agent";
import { createLogger } from "jsr:@runt/lib@^0.4.2";

// Health check endpoint for monitoring
const agentStatus = {
  initialized: false,
  lastHeartbeat: new Date().toISOString(),
  errors: [] as string[],
};

// Simple HTTP server for health checks
Deno.serve({
  port: 8000,
  handler: (req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      const health = {
        status: agentStatus.initialized ? "healthy" : "initializing",
        timestamp: new Date().toISOString(),
        lastHeartbeat: agentStatus.lastHeartbeat,
        uptime: Date.now() - startTime,
        errors: agentStatus.errors.slice(-5), // Last 5 errors
      };

      const status = agentStatus.initialized ? 200 : 503;
      return new Response(JSON.stringify(health, null, 2), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

const startTime = Date.now();

const logger = createLogger("deno-deploy-main");

/**
 * Environment variable configuration for Deno Deploy
 */
function getConfigFromEnv(): string[] {
  const args: string[] = [];

  // Required environment variables
  const notebookId = Deno.env.get("NOTEBOOK_ID");
  const authToken = Deno.env.get("AUTH_TOKEN");

  if (!notebookId) {
    throw new Error("NOTEBOOK_ID environment variable is required");
  }

  if (!authToken) {
    throw new Error("AUTH_TOKEN environment variable is required");
  }

  args.push("--notebook", notebookId);
  args.push("--auth-token", authToken);

  // Optional environment variables with defaults
  const syncUrl = Deno.env.get("SYNC_URL");
  if (syncUrl) {
    args.push("--sync-url", syncUrl);
  }

  const kernelId = Deno.env.get("KERNEL_ID");
  if (kernelId) {
    args.push("--kernel-id", kernelId);
  }

  const sessionId = Deno.env.get("SESSION_ID");
  if (sessionId) {
    args.push("--session-id", sessionId);
  }

  const heartbeatInterval = Deno.env.get("HEARTBEAT_INTERVAL");
  if (heartbeatInterval) {
    args.push("--heartbeat-interval", heartbeatInterval);
  }

  const logLevel = Deno.env.get("LOG_LEVEL");
  if (logLevel) {
    args.push("--log-level", logLevel);
  }

  // OpenAI configuration for AI cells
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiApiKey) {
    // This will be picked up by the OpenAIClient internally
    logger.info("OpenAI API key configured for AI cells");
  }

  return args;
}

/**
 * Get PyodideAgentOptions from environment variables
 */
function getAgentOptionsFromEnv() {
  const options: { packages?: string[] } = {};

  // Custom package list (comma-separated)
  const packagesEnv = Deno.env.get("PYODIDE_PACKAGES");
  if (packagesEnv) {
    options.packages = packagesEnv.split(",").map((pkg) => pkg.trim()).filter(
      Boolean,
    );
    logger.info("Custom Pyodide packages configured", {
      packages: options.packages,
    });
  }

  return options;
}

/**
 * Main function to run the Pyodide runtime agent on Deno Deploy
 */
async function main() {
  try {
    logger.info("Starting Pyodide runtime agent on Deno Deploy");
    agentStatus.lastHeartbeat = new Date().toISOString();

    // Log environment info (without sensitive data)
    logger.info("Environment configuration", {
      notebookId: Deno.env.get("NOTEBOOK_ID"),
      hasAuthToken: !!Deno.env.get("AUTH_TOKEN"),
      syncUrl: Deno.env.get("SYNC_URL"),
      kernelId: Deno.env.get("KERNEL_ID"),
      sessionId: Deno.env.get("SESSION_ID"),
      hasOpenAiKey: !!Deno.env.get("OPENAI_API_KEY"),
      customPackages: !!Deno.env.get("PYODIDE_PACKAGES"),
      logLevel: Deno.env.get("LOG_LEVEL") || "info",
      heartbeatInterval: Deno.env.get("HEARTBEAT_INTERVAL"),
    });

    // Get configuration from environment variables
    const args = getConfigFromEnv();
    const options = getAgentOptionsFromEnv();

    // Create and start the agent
    const agent = new PyodideRuntimeAgent(args, options);

    logger.info("Pyodide agent created, starting...");
    await agent.start();

    agentStatus.initialized = true;
    agentStatus.lastHeartbeat = new Date().toISOString();

    logger.info("Pyodide runtime agent started successfully", {
      kernelId: agent.config.kernelId,
      kernelType: agent.config.kernelType,
      notebookId: agent.config.notebookId,
      sessionId: agent.config.sessionId,
      syncUrl: agent.config.syncUrl,
      heartbeatInterval: agent.config.heartbeatInterval,
    });

    // Keep the agent alive - this is important for Deno Deploy
    logger.info("Agent running, keeping alive...");
    await agent.keepAlive();
  } catch (error) {
    logger.error("Failed to start Pyodide agent", error);

    // Record error for health check
    const errorMessage = error instanceof Error ? error.message : String(error);
    agentStatus.errors.push(`${new Date().toISOString()}: ${errorMessage}`);

    // In Deno Deploy, we want to provide helpful error messages
    if (error instanceof Error) {
      if (error.message.includes("NOTEBOOK_ID")) {
        logger.error(
          "Configuration Error: Set NOTEBOOK_ID in your Deno Deploy environment variables",
        );
      } else if (error.message.includes("AUTH_TOKEN")) {
        logger.error(
          "Configuration Error: Set AUTH_TOKEN in your Deno Deploy environment variables",
        );
      } else {
        logger.error("Startup Error:", error.message);
      }
    }

    // Exit with error code
    Deno.exit(1);
  }
}

// Handle graceful shutdown
function setupGracefulShutdown() {
  const shutdownHandler = () => {
    logger.info("Received shutdown signal, cleaning up...");
    Deno.exit(0);
  };

  // Handle various shutdown signals
  Deno.addSignalListener("SIGINT", shutdownHandler);
  Deno.addSignalListener("SIGTERM", shutdownHandler);
}

// Set up graceful shutdown
setupGracefulShutdown();

// Start the application
if (import.meta.main) {
  await main();
}
