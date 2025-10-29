// controller/qrcontroller.js
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import { query, getClient } from "../db/db.js";
import redis from "../db/redisClient.js";


/* ---------- helpers ---------- */

// Clean numeric-like inputs: "5800kg" -> 5800.0, " 1,234.5 kg " -> 1234.5
const cleanNumber = (val) => {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  // remove commas and non-numeric except dot and minus
  const cleaned = s.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// Ensure directory exists
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

// // Build redirect/display URL (adjust FRONTEND_URL via env if needed)
// const buildFrontendUrl = (shortId) => {
//   const base = process.env.FRONTEND_URL || "https://yourfrontend.com";
//   return `${base}/show-data?id=${shortId}`;
// };

// Build direct API URL (works for both online & offline)
const buildFrontendUrl = (shortId) => {
  // Change FRONTEND_URL in your .env if you deploy (example: https://yourdomain.com)
  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  // Direct API endpoint instead of /show-data
  return `${base}/api/info/${shortId}`;
};

export { buildFrontendUrl };

/* ---------- create / insert (POST) ---------- */
export const generateQRApi = async (req, res) => {
  try {
    const {
      projectName,
      client,
      event,
      date,
      primeContractor,
      subContractor,
      driverFirstName,
      driverLastName,
      phone,
      email,
      driverLicenseState,
      driverLicenseNumber,
      driverLicenseExpiry,
      vehicleType,
      truckNumber,
      customVehicleType,
      sideboards,
      openBack,
      handLoader,
      color,
      make,
      model,
      vinRegistrationInfo,
      licensePlateState,
      licensePlateTagNumber,
      licensePlateExpiry,
      baseMeasurement,
      additions,
      deductions,
      expiryAt,
      meta,
      updatedBy
    } = req.body;

    const driverName = `${driverFirstName} ${driverLastName}`;

    if (!driverName || !truckNumber || !driverLicenseNumber) {
      return res.status(400).json({ error: "driverName, truckNumber, and driverLicenseNumber are required" });
    }

    const shortId = `qr_${Date.now()}`;
    const qrMeta = typeof meta === "string" ? JSON.parse(meta || "{}") : (meta || {});

    const clientDB = await getClient();
    try {
      await clientDB.query("BEGIN");

      // 🧾 Insert main record (NO filePath yet)
      const insertText = `
        INSERT INTO qr_records (
          short_id, project_name, client, event, "date", prime_contractor, sub_contractor,
          driver_name, phone, email, driver_license_state, driver_license_number, driver_license_expiry,
          vehicle_type, truck_number, custom_vehicle_type, sideboards, open_back, hand_loader, color,
          make, model, vin_registration_info, license_plate_state, license_plate_tag_number,
          license_plate_expiry, base_measurement, additions, deductions,
          expiry_at, meta, scan_count
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,$13,
          $14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,
          $26,$27,$28,$29,
          $30,$31,$32
        )
        RETURNING *;
      `;


      const values = [
        shortId, projectName, client, event, date, primeContractor, subContractor,
        driverName, phone, email, driverLicenseState, driverLicenseNumber, driverLicenseExpiry,
        vehicleType, truckNumber, customVehicleType, sideboards, openBack, handLoader, JSON.stringify(color || []),
        make, model, vinRegistrationInfo, licensePlateState, licensePlateTagNumber,
        licensePlateExpiry, baseMeasurement, additions, deductions,
        expiryAt || null, qrMeta, 0
      ];

      const { rows } = await clientDB.query(insertText, values);
      const record = rows[0];


      // 🧩 Build complete payload for QR encoding
      const qrPayload = {
        id: record.id,
        projectName,
        client,
        event,
        primeContractor,
        subContractor,
        vehicleType,
        truckNumber,
        sideboards,
        openBack,
        handLoader,
        color,
        make,
        model,
        baseMeasurement,
        additions,
        deductions,
        expiryAt,
      };

      // 🖼️ Generate QR Image
      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload, null, 2));
      const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
      const dir = path.join(process.cwd(), "qr_codes");
      ensureDir(dir);
      const fileName = `qrcode_${shortId}.png`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, base64, "base64");

      await clientDB.query(
        `UPDATE qr_records 
         SET qr_image_path = $1 
         WHERE id = $2`,
        [filePath, record.id]  // record.id is a UUID string
      );


      // 🧾 Insert initial history snapshot
      const historyText = `
      INSERT INTO qr_records_history (
        qr_record_id, version, client, event, "date", prime_contractor, sub_contractor,
        driver_name, phone, email, driver_license_state, driver_license_number, driver_license_expiry,
        vehicle_type, truck_number, custom_vehicle_type, sideboards, open_back, hand_loader, color,
        make, model, vin_registration_info, license_plate_state, license_plate_tag_number,
        license_plate_expiry, base_measurement, additions, deductions, qr_image_path,
        expiry_at, meta, scan_count, operation_type, updated_at, updated_by
      )
      VALUES (
        $1,1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,
        $25,$26,$27,$28,$29,
        $30,$31,$32,'INSERT',NOW(),$33
      );
      `;


      const histValues = [
        record.id, client, event, date, primeContractor, subContractor,
        driverName, phone, email, driverLicenseState, driverLicenseNumber, driverLicenseExpiry,
        vehicleType, truckNumber, customVehicleType, sideboards, openBack, handLoader, JSON.stringify(color || []),
        make, model, vinRegistrationInfo, licensePlateState, licensePlateTagNumber,
        licensePlateExpiry, baseMeasurement, additions, deductions, filePath,
        expiryAt || null, qrMeta, 0, updatedBy || "system"
      ];

      await clientDB.query(historyText, histValues);

      await clientDB.query("COMMIT");
      // clientDB.release();

      // 🔁 Cache in Redis
      await redis.set(`record:${record.short_id}`, JSON.stringify(record));
      await redis.set(`record:${record.short_id}:scancount`, record.scan_count || 0);

      return res.json({
        message: "QR generated successfully",
        qrData: qrPayload,
        base64,
        shortId
      });
    } catch (err) {
      await clientDB.query("ROLLBACK");

      throw err;
    } finally {
      clientDB.release(); // always release exactly once
    }
  } catch (err) {
    console.error("generateQRApi error:", err);
    return res.status(500).json({ error: "Error generating QR", details: err.message });
  }
};


/* ---------- get info by short id (GET) ---------- */


export const getInfoById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "id is required" });

    // 1️⃣ Fetch record from Redis if exists
    let record;
    const cachedData = await redis.get(`record:${id}`);
    if (cachedData) {
      record = JSON.parse(cachedData);
      console.log("✅ Found in Redis cache");
    } else {
      // 2️⃣ Fetch from DB if not in cache
      const sel = await query(
        `SELECT * FROM qr_records WHERE short_id = $1`,
        [id]
      );
      if (sel.rowCount === 0) return res.status(404).json({ error: "QR record not found" });
      record = sel.rows[0];
    }

    // 3️⃣ Check expiry
    if (record.expiry_at && new Date(record.expiry_at) < new Date()) {
      return res.status(410).json({ error: "QR record has expired" });
    }

    // 4️⃣ Increment scan_count in DB
    const updated = await query(
      `UPDATE qr_records 
       SET scan_count = scan_count + 1, updated_at = NOW() 
       WHERE short_id = $1 
       RETURNING scan_count`,
      [id]
    );

    // 5️⃣ Update scan_count in the record object
    record.scan_count = updated.rows[0].scan_count;

    // 6️⃣ Update Redis cache with the full record
    await redis.set(`record:${id}`, JSON.stringify(record), "EX", 3600);
    console.log("🆕 Cached record in Redis with updated scan_count");

    // 7️⃣ Return full record as-is from DB
    return res.json(record);

  } catch (err) {
    console.error("getInfoById error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
};


/* ---------- update info (PUT) — critical: history snapshot BEFORE update ---------- */
export const updateInfoById = async (req, res) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { id } = req.params; // short_id used in URI
    const { ownerName, vehicleWeight, goodsWeight, driverName, expiryAt, meta, updatedBy } = req.body;

    if (!id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "id is required" });
    }

    // Lock the row so concurrent updates are safe
    const sel = await client.query(`SELECT * FROM qr_records WHERE short_id = $1 FOR UPDATE`, [id]);
    if (sel.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "QR record not found" });
    }

    const old = sel.rows[0];

    // Prepare sanitized values
    const vehicleWeightNum = vehicleWeight === undefined ? old.vehicle_weight : cleanNumber(vehicleWeight);
    const goodsWeightNum = goodsWeight === undefined ? old.goods_weight : cleanNumber(goodsWeight);
    const newMeta = (meta === undefined) ? old.meta : (typeof meta === "string" ? JSON.parse(meta) : meta);

    // Detect changes
    const changed =
      (ownerName !== undefined && ownerName !== old.owner_name) ||
      (vehicleWeight !== undefined && Number(vehicleWeightNum) !== Number(old.vehicle_weight)) ||
      (goodsWeight !== undefined && Number(goodsWeightNum) !== Number(old.goods_weight)) ||
      (driverName !== undefined && driverName !== old.driver_name) ||
      (expiryAt !== undefined && String(expiryAt) !== String(old.expiry_at)) ||
      (meta !== undefined && JSON.stringify(newMeta) !== JSON.stringify(old.meta));

    if (!changed) {
      await client.query("COMMIT");
      client.release();
      return res.json({ message: "No changes detected. Record unchanged.", record: old });
    }
    // Update Redis cache with fresh data
    // await redis.set(`record:${updatedRecord.short_id}`, JSON.stringify(updatedRecord));

    // 🔹 Determine if history needs to be added
    // Count total history entries and get max version
    const vres = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS maxv, 
              COUNT(*) AS total_count
       FROM qr_records_history
       WHERE qr_record_id = $1`,
      [old.id]
    );

    const lastHistoryVersion = Number(vres.rows[0].maxv || 0);
    const totalHistoryCount = Number(vres.rows[0].total_count || 0);

    // Check if record has been updated before (updated_at != created_at means at least one PATCH happened)
    const hasBeenUpdated = old.updated_at && old.created_at &&
      new Date(old.updated_at).getTime() !== new Date(old.created_at).getTime();

    // Only add history if:
    // 1. There's at least one history entry (from POST)
    // 2. AND the record has been updated before (first PATCH already happened)
    const shouldInsertHistory = totalHistoryCount >= 1 && hasBeenUpdated;

    if (shouldInsertHistory) {
      const nextVersion = lastHistoryVersion + 1;
      const insertHistory = `
        INSERT INTO qr_records_history
        (qr_record_id, version, owner_name, vehicle_weight, goods_weight, driver_name, qr_image_path, meta, scan_count, operation_type, updated_at, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
      `;
      await client.query(insertHistory, [
        old.id,
        nextVersion,
        old.owner_name,
        old.vehicle_weight,
        old.goods_weight,
        old.driver_name,
        old.qr_image_path,
        old.meta,
        old.scan_count,
        "UPDATE",
        updatedBy || req.user?.name || "system"
      ]);
    }

    // 🔹 Build dynamic update query
    const sets = [];
    const vals = [];
    let idx = 1;
    if (ownerName !== undefined) { sets.push(`owner_name = $${idx++}`); vals.push(ownerName); }
    if (vehicleWeight !== undefined) { sets.push(`vehicle_weight = $${idx++}`); vals.push(vehicleWeightNum); }
    if (goodsWeight !== undefined) { sets.push(`goods_weight = $${idx++}`); vals.push(goodsWeightNum); }
    if (driverName !== undefined) { sets.push(`driver_name = $${idx++}`); vals.push(driverName); }
    if (expiryAt !== undefined) { sets.push(`expiry_at = $${idx++}`); vals.push(expiryAt); }
    if (meta !== undefined) { sets.push(`meta = $${idx++}`); vals.push(newMeta); }
    sets.push(`updated_at = NOW()`);

    vals.push(id); // WHERE short_id

    const updateQuery = `UPDATE qr_records SET ${sets.join(", ")} WHERE short_id = $${vals.length} RETURNING *`;
    const updateRes = await client.query(updateQuery, vals);
    const updatedRecord = updateRes.rows[0];

    await redis.set(`record:${updatedRecord.short_id}`, JSON.stringify(updatedRecord));

    // Delete 'all_records' cache to ensure updated info appears in next GET /all
    await redis.del("records:all");

    // 🔹 Regenerate QR image
    const qrPayload = {
      shortId: updatedRecord.short_id,
      ownerName: updatedRecord.owner_name,
      vehicleWeight: updatedRecord.vehicle_weight,
      goodsWeight: updatedRecord.goods_weight,
      driverName: updatedRecord.driver_name,
      createdAt: updatedRecord.created_at,
      expiryAt: updatedRecord.expiry_at,
      url: buildFrontendUrl(updatedRecord.short_id),
      meta: updatedRecord.meta
    };

    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload, null, 2));
    const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const outPath = updatedRecord.qr_image_path || path.join(process.cwd(), "qr_codes", `qrcode_${updatedRecord.short_id}.png`);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, base64, "base64");

    await client.query("COMMIT");
    client.release();

    // 🔹 Final response
    const dynamicUrl = buildFrontendUrl(updatedRecord.short_id);
    return res.json({
      message: "QR record updated successfully",
      record: {
        shortId: updatedRecord.short_id,
        ownerName: updatedRecord.owner_name,
        vehicleWeight: updatedRecord.vehicle_weight,
        goodsWeight: updatedRecord.goods_weight,
        driverName: updatedRecord.driver_name,
        qrImagePath: updatedRecord.qr_image_path,
        scanCount: updatedRecord.scan_count,
        createdAt: updatedRecord.created_at,
        updatedAt: updatedRecord.updated_at,
        expiryAt: updatedRecord.expiry_at,
        meta: updatedRecord.meta,
        url: dynamicUrl
      }
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { }
    client.release();
    console.error("updateInfoById error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
};



export const getAllRecords = async (req, res) => {
  try {
    const cacheKey = "records:all";

    // 1️⃣ Try fetching from Redis first
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("✅ Serving all records from Redis cache");
      return res.json(JSON.parse(cached));
    }

    // 2️⃣ If not cached, fetch from DB
    const result = await query(`
      SELECT short_id, owner_name, vehicle_weight, goods_weight, driver_name, 
             qr_image_path, scan_count, created_at, updated_at, expiry_at, meta
      FROM qr_records
      ORDER BY created_at DESC
    `);

    const records = result.rows.map((rec) => ({
      shortId: rec.short_id,
      ownerName: rec.owner_name,
      vehicleWeight: rec.vehicle_weight,
      goodsWeight: rec.goods_weight,
      driverName: rec.driver_name,
      qrImagePath: rec.qr_image_path,
      scanCount: rec.scan_count,
      createdAt: rec.created_at,
      updatedAt: rec.updated_at,
      expiryAt: rec.expiry_at,
      meta: rec.meta,
      url: buildFrontendUrl(rec.short_id),
    }));

    // 3️⃣ Cache the records for 1 hour
    await redis.set(cacheKey, JSON.stringify(records), "EX", 3600);
    console.log("🆕 Cached all records in Redis");

    return res.json(records);
  } catch (err) {
    console.error("getAllRecords error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
};



/* ------ Field Monitor ------  */
export const generateLoadTicketQR = async (req, res) => {
  console.log(req.body, '-- body ---')
  try {
    const {
      truckCertificationDetails,
      fieldMonitorName,
      subActivity,
      debrisType,
      loadDate,
      loadTime,
      latitude,
      longitude,
      address,
      fieldMonitorNotes,
      truckCapacity
    } = req.body;

    if (!truckCertificationDetails?.id || !fieldMonitorName) {
      return res.status(400).json({
        error: "truckCertificationDetails.id and fieldMonitorName are required",
      });
    }

    const clientDB = await getClient();

    try {
      await clientDB.query("BEGIN");

      // 1️⃣ Insert ticket record without QR path
      const insertText = `
        INSERT INTO load_ticket (
          truck_certificate_id,
          field_monitor_name,
          sub_activity,
          debris_type,
          load_date,
          load_time,
          latitude,
          longitude,
          address,
          field_monitor_notes,
          truck_capacity
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )
        RETURNING *;
      `;
      const insertValues = [
        truckCertificationDetails.id,
        fieldMonitorName,
        subActivity,
        debrisType,
        loadDate,
        loadTime,
        latitude,
        longitude,
        address,
        fieldMonitorNotes,
        truckCapacity || null
      ];

      const { rows } = await clientDB.query(insertText, insertValues);
      const ticketRecord = rows[0];

      // 2️⃣ Generate QR payload including ticket id
      const shortId = `loadticket_${Date.now()}`;
      const qrPayload = {
        ticketId: ticketRecord.id,
        shortId,
        truckCertificationDetails,
        fieldMonitorName,
        subActivity,
        debrisType,
        loadDate,
        loadTime,
        latitude,
        longitude,
        address,
        fieldMonitorNotes,
        truckCapacity
      };

      // 3️⃣ Generate QR image
      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload, null, 2));
      const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
      const dir = path.join(process.cwd(), "qr_codes");
      ensureDir(dir);
      const fileName = `loadticket_${shortId}.png`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, base64, "base64");

      // 4️⃣ Update ticket with QR path
      await clientDB.query(
        `UPDATE load_ticket 
        SET load_qr_image_path = $1
        WHERE id = $2`,
        [filePath, ticketRecord.id] // ticketRecord.id can be a UUID
      );


      await clientDB.query("COMMIT");

      return res.json({
        message: "Load ticket QR generated successfully",
        qrData: qrPayload,
        base64,
        shortId,
        ticketRecord
      });
    } catch (err) {
      await clientDB.query("ROLLBACK");
      throw err;
    } finally {
      clientDB.release();
    }
  } catch (err) {
    console.error("generateLoadTicketQR error:", err);
    return res.status(500).json({
      error: "Error generating load ticket QR",
      details: err.message
    });
  }
};


/* --- Site Monitor ------  */
export const generateDisposalTicket = async (req, res) => {
  console.log(req.body, '-- body ---');
  try {
    const {
      load_ticket_id,   // full load ticket info (for QR only)
      truck_certificate_id,
      disposal_site,
      offload_date,
      offload_time,
      debris_type,
      load_call,
      confirm_quantity,
      tipping_ticket_number,
      tipping_fee,
      site_monitor_notes,
      site_monitor_name
    } = req.body;

    if (!load_ticket_id || !disposal_site) {
      return res.status(400).json({
        error: "load_ticket_id and disposal_site are required"
      });
    }

    const clientDB = await getClient();

    try {
      await clientDB.query("BEGIN");

      // 1️⃣ Insert disposal ticket record without QR path
      const insertText = `
        INSERT INTO disposal_ticket (
          load_ticket_id,
          disposal_site,
          offload_date,
          offload_time,
          debris_type,
          load_call,
          confirm_quantity,
          tipping_ticket_number,
          tipping_fee,
          site_monitor_notes,
          site_monitor_name
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *;
      `;

      const insertValues = [
        load_ticket_id,
        disposal_site,
        offload_date,
        offload_time,
        debris_type,
        load_call || 0,
        confirm_quantity || null,
        tipping_ticket_number || null,
        tipping_fee || null,
        site_monitor_notes || '',
        site_monitor_name
      ];

      const { rows } = await clientDB.query(insertText, insertValues);
      const disposalRecord = rows[0];

      const loadTicketQuery = `
        SELECT lt.*, qr.*
        FROM load_ticket lt
        LEFT JOIN qr_records qr
          ON lt.truck_certificate_id = qr.id
        WHERE lt.id = $1;
      `;
      const { rows: ticketRows } = await clientDB.query(loadTicketQuery, [load_ticket_id]);
      if (ticketRows.length === 0) {
        await clientDB.query("ROLLBACK");
        return res.status(404).json({ error: "Load ticket not found" });
      }

      const loadTicketDetails = ticketRows[0];

      await clientDB.query("COMMIT");

      return res.json({
        message: "Disposal ticket generated successfully",
        disposalRecord,
        loadTicketDetails
      });
    } catch (err) {
      await clientDB.query("ROLLBACK");
      throw err;
    } finally {
      clientDB.release();
    }
  } catch (err) {
    console.error("generateDisposalTicket error:", err);
    return res.status(500).json({
      error: "Error generating disposal ticket",
      details: err.message
    });
  }
};
