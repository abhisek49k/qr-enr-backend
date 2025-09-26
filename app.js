import express from "express";
import qrRoutes from "./routes/qrroutes.js";

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use("/", qrRoutes);


// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
