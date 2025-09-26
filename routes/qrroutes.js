import express from "express";
import { generateQRApi, getInfoById, updateInfoById } from "../controller/qrcontroller.js";

const router = express.Router();

router.post("/api/generate", generateQRApi);



// Get latest info by short id (used when QR scanned)
router.get("/api/info/:id", getInfoById);

// Update info for an existing QR (partial updates allowed)
router.put("/api/info/:id", updateInfoById);

export default router  ;
