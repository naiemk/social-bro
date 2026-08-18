import type { IAgentRuntime, Plugin } from "@elizaos/core";
import { logger, Service } from "@elizaos/core";

/**
 * Optional WhatsApp channel using a QR session (Baileys), not Meta Cloud API.
 * Starts only when WHATSAPP_ENABLED=true. Install @whiskeysockets/baileys to connect.
 */
export class WhatsAppService extends Service {
  static serviceType = "whatsapp-baileys";
  capabilityDescription = "Optional WhatsApp QR session for customer support.";

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    const service = new WhatsAppService(runtime);
    const enabled =
      String(
        runtime.getSetting("WHATSAPP_ENABLED") ||
          process.env.WHATSAPP_ENABLED ||
          "",
      ).toLowerCase() === "true";
    if (!enabled) {
      logger.info(
        "WhatsApp plugin idle (set WHATSAPP_ENABLED=true to use QR login)",
      );
      return service;
    }
    try {
      const specifier = "@whiskeysockets/baileys";
      const baileys = (await import(specifier)) as {
        default: (opts: Record<string, unknown>) => {
          ev: {
            on: (
              event: string,
              cb: (update: Record<string, unknown>) => void,
            ) => void;
          };
        };
        useMultiFileAuthState: (
          dir: string,
        ) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
      };
      logger.info(
        "Baileys loaded. Scan the QR in the terminal to link WhatsApp.",
      );
      const makeWASocket = baileys.default;
      const { state, saveCreds } = await baileys.useMultiFileAuthState(
        String(
          runtime.getSetting("WHATSAPP_AUTH_DIR") || ".eliza/whatsapp-auth",
        ),
      );
      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });
      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", (update) => {
        const connection = String(update.connection || "");
        if (connection === "close") {
          logger.warn({ update }, "WhatsApp connection closed");
        }
        if (connection === "open") {
          logger.info("WhatsApp QR session connected");
        }
      });
    } catch (error) {
      logger.warn(
        { error },
        "WhatsApp enabled but @whiskeysockets/baileys is not installed. Run: bun add @whiskeysockets/baileys",
      );
    }
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(WhatsAppService.serviceType);
    if (service) await service.stop();
  }

  async stop() {
    logger.info("Stopping WhatsApp service");
  }
}

export const whatsappPlugin: Plugin = {
  name: "whatsapp-baileys",
  description:
    "Optional WhatsApp support via QR session. Off unless WHATSAPP_ENABLED=true.",
  services: [WhatsAppService],
};

export default whatsappPlugin;
