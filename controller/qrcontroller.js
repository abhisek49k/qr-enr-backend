import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { query } from "../db/db.js";
// API to generate QR code and save as PNG
export const generateQRApi = async (req, res) => {
  const { ownerName, vehicleWeight, goodsWeight, driverName, expiryAt, meta } = req.body;

  if (!ownerName || !vehicleWeight || !goodsWeight || !driverName) {
    return res.status(400).json({
      error: "All fields (ownerName, vehicleWeight, goodsWeight, driverName) are required"
    });
  }

  try {
    // Generate unique shortId
    const shortId = `qr_${Date.now()}`;

    // Build redirect URL
    const redirectUrl = `https://yourfrontend.com/show-data?id=${shortId}`;

    // Create full data object (everything you want in QR)
    const qrData = {
      shortId,
      ownerName,
      vehicleWeight,
      goodsWeight,
      driverName,
      createdAt: new Date().toISOString(),
      expiryAt: expiryAt || null,
      // meta: meta || {},
      url: redirectUrl
    };

    // Convert object to string for QR
    const qrString = JSON.stringify(qrData, null, 2);

    // Generate QR code as Data URL
    const qrCodeData = await QRCode.toDataURL(qrString);

    // Convert Base64 to PNG
    const base64Data = qrCodeData.replace(/^data:image\/png;base64,/, "");

    // Save PNG file locally
    const fileName = `qrcode_${Date.now()}.png`;
    const filePath = path.join("qr_codes", fileName);

    fs.mkdirSync("qr_codes", { recursive: true });
    fs.writeFileSync(filePath, base64Data, "base64");

    // ✅ Insert into DB
    const insertText = `
  INSERT INTO qr_records 
  (short_id, owner_name, vehicle_weight, goods_weight, driver_name, qr_image_path, created_at, expiry_at, meta, scan_count)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;

await query(insertText, [
  shortId,
  ownerName,
  vehicleWeight,
  goodsWeight,
  driverName,
  filePath,
  new Date(),           // created_at
  expiryAt || null,     // expiry_at
  qrData,               // meta
  0                     // scan_count (initially 0)
]);

    // Return response
    res.json({
      message: "QR code generated successfully",
      qrData,
      fileName,
      filePath
    });
  } catch (err) {
    console.error("generateQRApi error:", err);
    res.status(500).json({ error: "Error generating QR code", details: err.message });
  }
};



/**
 * GET /api/info/:id
 * Return the latest info for this short id.
 * Also increments scan_count and logs minimal scan info.
 */
export const getInfoById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "id is required" });

    // Fetch record
    const selectText = `SELECT short_id, owner_name, vehicle_weight, goods_weight, driver_name, qr_image_path, scan_count, created_at, updated_at, expiry_at, meta
                        FROM qr_records WHERE short_id = $1`;
    const result = await query(selectText, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "QR record not found" });
    }

    const record = result.rows[0];

    // Check expiry
    if (record.expiry_at && new Date(record.expiry_at) < new Date()) {
      return res.status(410).json({ error: "QR record has expired" });
    }

    // Increment scan_count
    const incText = `UPDATE qr_records SET scan_count = scan_count + 1 WHERE short_id = $1`;
    await query(incText, [id]);

    // Build redirect URL
    const redirectUrl = `https://yourfrontend.com/show-data?id=${record.short_id}`;

    // Return full data (everything you passed in body) + url
    return res.json({
      shortId: record.short_id,
      ownerName: record.owner_name,
      vehicleWeight: record.vehicle_weight,
      goodsWeight: record.goods_weight,
      driverName: record.driver_name,
      qrImagePath: record.qr_image_path,
      scanCount: record.scan_count + 1,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      expiryAt: record.expiry_at,
      // meta: record.meta,
      url: redirectUrl   // ✅ Added URL
    });

  } catch (err) {
    console.error("getInfoById error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
};



/**
 * PUT /api/info/:id
 * Updates owner/weights/driver (partial update allowed). Returns updated record.
 */
export const updateInfoById = async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerName, vehicleWeight, goodsWeight, driverName, expiryAt, meta } = req.body;

    if (!id) return res.status(400).json({ error: "id is required" });

    // Check if record exists and get current data
    const existsResult = await query(`SELECT * FROM qr_records WHERE short_id = $1`, [id]);
    if (existsResult.rowCount === 0) {
      return res.status(404).json({ error: "QR record not found" });
    }
    
    const currentRecord = existsResult.rows[0];

    // Build dynamic UPDATE query based on provided fields
    const fields = [];
    const values = [];
    let idx = 1;

    if (ownerName !== undefined) { fields.push(`owner_name = $${idx++}`); values.push(ownerName); }
    if (vehicleWeight !== undefined) { fields.push(`vehicle_weight = $${idx++}`); values.push(vehicleWeight); }
    if (goodsWeight !== undefined) { fields.push(`goods_weight = $${idx++}`); values.push(goodsWeight); }
    if (driverName !== undefined) { fields.push(`driver_name = $${idx++}`); values.push(driverName); }
    if (expiryAt !== undefined) { fields.push(`expiry_at = $${idx++}`); values.push(expiryAt); }
    if (meta !== undefined) { fields.push(`meta = $${idx++}`); values.push(meta); }

    if (fields.length === 0) return res.status(400).json({ error: "No updatable fields provided" });

    // Always update updated_at
    fields.push(`updated_at = now()`);

    // Update the record
    const updateQuery = `
      UPDATE qr_records
      SET ${fields.join(", ")}
      WHERE short_id = $${idx}
      RETURNING short_id
    `;
    values.push(id);

    const updateResult = await query(updateQuery, values);
    const updated = updateResult.rows[0];

    // Fetch the full updated record
    const selectText = `
      SELECT short_id, owner_name, vehicle_weight, goods_weight, driver_name,
             qr_image_path, scan_count, created_at, updated_at, expiry_at, meta
      FROM qr_records
      WHERE short_id = $1
    `;
    const result = await query(selectText, [updated.short_id]);
    const record = result.rows[0];

    // Build redirect URL (same as in generate function)
    const redirectUrl = `https://yourfrontend.com/show-data?id=${record.short_id}`;

    // Create updated QR data object
    const updatedQrData = {
      shortId: record.short_id,
      ownerName: record.owner_name,
      vehicleWeight: record.vehicle_weight,
      goodsWeight: record.goods_weight,
      driverName: record.driver_name,
      createdAt: record.created_at,
      expiryAt: record.expiry_at,
      // meta: record.meta,
      url: redirectUrl
    };

    // Convert updated object to string for QR
    const qrString = JSON.stringify(updatedQrData, null, 2);

    // Generate new QR code with updated data
    const qrCodeData = await QRCode.toDataURL(qrString);

    // Convert Base64 to PNG
    const base64Data = qrCodeData.replace(/^data:image\/png;base64,/, "");

    // Use the same file path to overwrite the existing QR image
    const existingFilePath = record.qr_image_path;
    
    // Make sure directory exists
    const dir = path.dirname(existingFilePath);
    fs.mkdirSync(dir, { recursive: true });
    
    // Overwrite the existing QR code file with updated data
    fs.writeFileSync(existingFilePath, base64Data, "base64");

    // Build dynamic URL (same URL that QR points to)
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const dynamicUrl = `${baseUrl}/api/info/${record.short_id}`;

    // Return full updated info (same structure as generate API)
    return res.json({
      message: "QR record and QR code updated successfully",
      record: {
        shortId: record.short_id,
        ownerName: record.owner_name,
        vehicleWeight: record.vehicle_weight,
        goodsWeight: record.goods_weight,
        driverName: record.driver_name,
        qrImagePath: record.qr_image_path,
        scanCount: record.scan_count,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        expiryAt: record.expiry_at,
        // meta: record.meta,
        url: dynamicUrl
      }
    });

  } catch (err) {
    console.error("updateInfoById error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
};
