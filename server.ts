import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // PDF Export & Email
  app.post("/api/export/email", async (req, res) => {
    const { email, pdfData, sessionName } = req.body;
    
    if (!email || !pdfData) {
      return res.status(400).json({ error: "Email and PDF data are required" });
    }

    try {
      // Mock transporter for demo
      // In production, use real SMTP credentials from process.env
      const transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL_USER || "mock_user",
          pass: process.env.EMAIL_PASS || "mock_pass",
        },
      });

      const info = await transporter.sendMail({
        from: '"TafelFlow" <noreply@tafelflow.app>',
        to: email,
        subject: `TafelFlow Export: ${sessionName}`,
        text: `Anbei findest du den Export deiner Sitzung: ${sessionName}`,
        attachments: [
          {
            filename: `${sessionName}.pdf`,
            content: pdfData.split("base64,")[1],
            encoding: "base64",
          },
        ],
      });

      res.json({ success: true, messageId: info.messageId });
    } catch (error) {
      console.error("Email error:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
