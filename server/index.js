import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";

const app = express();

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json()); // Ensure JSON body parsing
app.use(express.urlencoded({ extended: true })); // Allow URL-encoded data

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve Static Frontend Files from `/client`
app.use(express.static(path.join(__dirname, "../client")));

// API Routes
app.use("/auth", authRoutes);
app.use("/projects", projectRoutes);

// Serve `index.html` for the root route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
    console.error("Server Error:", err.message);
    res.status(500).json({ message: "Internal Server Error", error: err.message });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
