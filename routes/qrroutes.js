// routes/qrroutes.js
import express from "express";
import { generateQRApi, getInfoById, updateInfoById, getAllRecords, generateLoadTicketQR, generateDisposalTicket } from "../controller/qrcontroller.js";

const router = express.Router();

router.post("/api/generate", generateQRApi);
router.get("/api/info/:id", getInfoById);
router.put("/api/info/:id", updateInfoById);

// optional history route for debugging/inspection
router.get("/records", getAllRecords);

/* Filed Monitor (Load Ticket) */
router.post("/api/generateloadticket", generateLoadTicketQR);
router.post("/api/generatedisposalticket", generateDisposalTicket);

export default router;
