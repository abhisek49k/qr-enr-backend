// app.js
import express from "express";
import qrRoutes from "./routes/qrroutes.js";

const app = express();
app.use(express.json());

// routes
app.use("/", qrRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
