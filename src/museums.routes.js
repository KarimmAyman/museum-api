import { Router } from 'express'
import { supabase } from './supabaseClient.js'
import QRCode from 'qrcode'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'

const router = Router()

// Multer: store files in memory buffer for Supabase upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true)
        } else {
            cb(new Error('Only image files are allowed'), false)
        }
    }
})


// ======================
// HELPER: Generate QR code and upload to Supabase Storage
// Returns public URL string
// ======================
async function generateAndUploadQR(museumId, museumName) {
    // QR content: embed museum ID + name for rich scanning
    const qrContent = JSON.stringify({ id: museumId, name: museumName })

    // Generate QR as PNG buffer
    const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png',
        width: 400,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    })

    const fileName = `qr_${museumId}.png`

    const { error: uploadError } = await supabase.storage
        .from('museum-qrcodes')
        .upload(fileName, qrBuffer, {
            contentType: 'image/png',
            upsert: true // overwrite if regenerated
        })

    if (uploadError) throw new Error(`QR upload failed: ${uploadError.message}`)

    const { data: urlData } = supabase.storage
        .from('museum-qrcodes')
        .getPublicUrl(fileName)

    return urlData.publicUrl
}


// ======================
// HELPER: Upload floor image to Supabase Storage
// Returns public URL string
// ======================
async function uploadFloorImage(buffer, mimetype, museumId, floorNumber) {
    const ext = mimetype.split('/')[1] // e.g. "jpeg", "png"
    const fileName = `floor_${museumId}_${floorNumber}_${uuidv4()}.${ext}`

    const { error: uploadError } = await supabase.storage
        .from('floor-images')
        .upload(fileName, buffer, {
            contentType: mimetype,
            upsert: false
        })

    if (uploadError) throw new Error(`Floor image upload failed: ${uploadError.message}`)

    const { data: urlData } = supabase.storage
        .from('floor-images')
        .getPublicUrl(fileName)

    return urlData.publicUrl
}


// ============================================================
// MUSEUMS
// ============================================================

// POST /museums — Create museum (name only), auto-generate QR
router.post('/', async (req, res) => {
    try {
        const { museum_name } = req.body

        if (!museum_name || museum_name.trim() === '') {
            return res.status(400).json({ error: 'museum_name is required' })
        }

        // Step 1: Insert museum first to get the generated UUID
        const { data: museum, error: insertError } = await supabase
            .from('museums')
            .insert([{ museum_name: museum_name.trim() }])
            .select()
            .single()

        if (insertError) {
            return res.status(500).json({ error: insertError.message })
        }

        // Step 2: Generate QR code and upload using the real ID
        let imageUrl = null
        try {
            imageUrl = await generateAndUploadQR(museum.id, museum.museum_name)
        } catch (qrErr) {
            console.error('QR generation error (non-fatal):', qrErr.message)
            // Museum is still created — QR failure is non-fatal
        }

        // Step 3: Save the QR image URL back into the museum row
        if (imageUrl) {
            const { data: updated, error: updateError } = await supabase
                .from('museums')
                .update({ image: imageUrl })
                .eq('id', museum.id)
                .select()
                .single()

            if (updateError) {
                console.error('Failed to save QR URL:', updateError.message)
                // Return museum without image rather than failing
                return res.status(201).json(museum)
            }

            return res.status(201).json(updated)
        }

        return res.status(201).json(museum)

    } catch (err) {
        console.error('POST /museums error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// GET /museums — Get all museums
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('museums')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) return res.status(500).json({ error: error.message })

        return res.json(data)

    } catch (err) {
        console.error('GET /museums error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// GET /museums/:id — Get museum by ID (with all its floors)
router.get('/:id', async (req, res) => {
    try {
        const { data: museum, error: museumError } = await supabase
            .from('museums')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle()

        if (museumError) return res.status(500).json({ error: museumError.message })
        if (!museum) return res.status(404).json({ error: 'Museum not found' })

        // Fetch floors sorted by floor_number
        const { data: floors, error: floorsError } = await supabase
            .from('floors')
            .select('*')
            .eq('museum_id', req.params.id)
            .order('floor_number', { ascending: true })

        if (floorsError) return res.status(500).json({ error: floorsError.message })

        return res.json({ ...museum, floors: floors || [] })

    } catch (err) {
        console.error('GET /museums/:id error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// PUT /museums/:id — Update museum name
router.put('/:id', async (req, res) => {
    try {
        const { museum_name } = req.body

        if (!museum_name || museum_name.trim() === '') {
            return res.status(400).json({ error: 'museum_name is required' })
        }

        const { data, error } = await supabase
            .from('museums')
            .update({ museum_name: museum_name.trim() })
            .eq('id', req.params.id)
            .select()
            .maybeSingle()

        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Museum not found' })

        return res.json(data)

    } catch (err) {
        console.error('PUT /museums/:id error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// POST /museums/:id/regenerate-qr — Regenerate QR code for a museum
router.post('/:id/regenerate-qr', async (req, res) => {
    try {
        const { data: museum, error: fetchError } = await supabase
            .from('museums')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle()

        if (fetchError) return res.status(500).json({ error: fetchError.message })
        if (!museum) return res.status(404).json({ error: 'Museum not found' })

        const imageUrl = await generateAndUploadQR(museum.id, museum.museum_name)

        const { data: updated, error: updateError } = await supabase
            .from('museums')
            .update({ image: imageUrl })
            .eq('id', museum.id)
            .select()
            .single()

        if (updateError) return res.status(500).json({ error: updateError.message })

        return res.json(updated)

    } catch (err) {
        console.error('POST /museums/:id/regenerate-qr error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// DELETE /museums/:id — Delete museum (cascades to floors)
router.delete('/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('museums')
            .delete()
            .eq('id', req.params.id)

        if (error) return res.status(500).json({ error: error.message })

        return res.status(204).send()

    } catch (err) {
        console.error('DELETE /museums/:id error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// ============================================================
// FLOORS  (nested under /museums/:id/floors)
// ============================================================

// POST /museums/:id/floors — Add a floor with optional image, map_data, scale
// Accepts multipart/form-data for image upload
router.post('/:id/floors', upload.single('floor_image'), async (req, res) => {
    try {
        const museumId = req.params.id

        // Validate museum exists
        const { data: museum, error: museumError } = await supabase
            .from('museums')
            .select('id')
            .eq('id', museumId)
            .maybeSingle()

        if (museumError) return res.status(500).json({ error: museumError.message })
        if (!museum) return res.status(404).json({ error: 'Museum not found' })

        // Validate floor_number
        const floorNumber = parseInt(req.body.floor_number, 10)
        if (isNaN(floorNumber) || floorNumber < 1) {
            return res.status(400).json({ error: 'floor_number must be a positive integer' })
        }

        // Validate scale if provided
        let scale = null
        if (req.body.scale !== undefined && req.body.scale !== '') {
            scale = parseFloat(req.body.scale)
            if (isNaN(scale)) {
                return res.status(400).json({ error: 'scale must be a valid number' })
            }
        }

        // Upload floor image if provided
        let floorImageUrl = null
        if (req.file) {
            floorImageUrl = await uploadFloorImage(
                req.file.buffer,
                req.file.mimetype,
                museumId,
                floorNumber
            )
        }

        // map_data is saved as a text string (JSON string from client)
        const mapData = req.body.map_data || null

        const { data: floor, error: insertError } = await supabase
            .from('floors')
            .insert([{
                museum_id: museumId,
                floor_number: floorNumber,
                floor_image: floorImageUrl,
                map_data: mapData,
                scale
            }])
            .select()
            .single()

        if (insertError) {
            // Handle unique constraint violation (floor already exists)
            if (insertError.code === '23505') {
                return res.status(409).json({
                    error: `Floor ${floorNumber} already exists for this museum`
                })
            }
            return res.status(500).json({ error: insertError.message })
        }

        return res.status(201).json(floor)

    } catch (err) {
        console.error('POST /museums/:id/floors error:', err)
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})


// GET /museums/:id/floors — Get all floors of a museum
router.get('/:id/floors', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('floors')
            .select('*')
            .eq('museum_id', req.params.id)
            .order('floor_number', { ascending: true })

        if (error) return res.status(500).json({ error: error.message })

        return res.json(data)

    } catch (err) {
        console.error('GET /museums/:id/floors error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// GET /museums/:id/floors/:floorId — Get a specific floor
router.get('/:id/floors/:floorId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('floors')
            .select('*')
            .eq('id', req.params.floorId)
            .eq('museum_id', req.params.id)
            .maybeSingle()

        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Floor not found' })

        return res.json(data)

    } catch (err) {
        console.error('GET /museums/:id/floors/:floorId error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})


// PUT /museums/:id/floors/:floorId — Update floor data (map_data, scale, floor_image)
router.put('/:id/floors/:floorId', upload.single('floor_image'), async (req, res) => {
    try {
        // Fetch existing floor to verify ownership
        const { data: existing, error: fetchError } = await supabase
            .from('floors')
            .select('*')
            .eq('id', req.params.floorId)
            .eq('museum_id', req.params.id)
            .maybeSingle()

        if (fetchError) return res.status(500).json({ error: fetchError.message })
        if (!existing) return res.status(404).json({ error: 'Floor not found' })

        const updates = {}

        if (req.body.map_data !== undefined) updates.map_data = req.body.map_data

        if (req.body.scale !== undefined && req.body.scale !== '') {
            const scale = parseFloat(req.body.scale)
            if (isNaN(scale)) {
                return res.status(400).json({ error: 'scale must be a valid number' })
            }
            updates.scale = scale
        }

        // Upload new floor image if provided
        if (req.file) {
            updates.floor_image = await uploadFloorImage(
                req.file.buffer,
                req.file.mimetype,
                req.params.id,
                existing.floor_number
            )
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' })
        }

        const { data, error: updateError } = await supabase
            .from('floors')
            .update(updates)
            .eq('id', req.params.floorId)
            .select()
            .single()

        if (updateError) return res.status(500).json({ error: updateError.message })

        return res.json(data)

    } catch (err) {
        console.error('PUT /museums/:id/floors/:floorId error:', err)
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})


// DELETE /museums/:id/floors/:floorId — Delete a floor
router.delete('/:id/floors/:floorId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('floors')
            .delete()
            .eq('id', req.params.floorId)
            .eq('museum_id', req.params.id)

        if (error) return res.status(500).json({ error: error.message })

        return res.status(204).send()

    } catch (err) {
        console.error('DELETE /museums/:id/floors/:floorId error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})

export default router