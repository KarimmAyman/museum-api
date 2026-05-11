import { Router } from 'express'
import { supabase } from './supabaseClient.js'
import QRCode from 'qrcode'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'

const router = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true)
        else cb(new Error('Only image files are allowed'), false)
    }
})

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
async function generateAndUploadQR(museumId, museumName) {
    const qrContent = JSON.stringify({ id: museumId, name: museumName })
    const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png', width: 400, margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
    })
    const fileName = `qr_${museumId}.png`
    const { error } = await supabase.storage
        .from('museum-qrcodes')
        .upload(fileName, qrBuffer, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`QR upload failed: ${error.message}`)
    const { data } = supabase.storage.from('museum-qrcodes').getPublicUrl(fileName)
    return data.publicUrl
}

async function uploadFloorImage(buffer, mimetype, museumId, floorNumber) {
    const ext = mimetype.split('/')[1]
    const fileName = `floor_${museumId}_${floorNumber}_${uuidv4()}.${ext}`
    const { error } = await supabase.storage
        .from('floor-images')
        .upload(fileName, buffer, { contentType: mimetype, upsert: false })
    if (error) throw new Error(`Floor image upload failed: ${error.message}`)
    const { data } = supabase.storage.from('floor-images').getPublicUrl(fileName)
    return data.publicUrl
}

// ─────────────────────────────────────────
// MUSEUMS CRUD
// ─────────────────────────────────────────

// POST /museums
router.post('/', async (req, res) => {
    try {
        const { museum_name } = req.body
        if (!museum_name?.trim())
            return res.status(400).json({ error: 'museum_name is required' })

        const { data: museum, error } = await supabase
            .from('museums')
            .insert([{ museum_name: museum_name.trim() }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })

        let imageUrl = null
        try { imageUrl = await generateAndUploadQR(museum.id, museum.museum_name) }
        catch (e) { console.error('QR error (non-fatal):', e.message) }

        if (imageUrl) {
            const { data: updated, error: ue } = await supabase
                .from('museums').update({ image: imageUrl })
                .eq('id', museum.id).select().single()
            if (ue) return res.status(201).json(museum)
            return res.status(201).json(updated)
        }
        return res.status(201).json(museum)
    } catch (err) {
        console.error('POST /museums:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /museums
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('museums').select('*')
            .order('created_at', { ascending: false })
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /museums/:id  — with floors
router.get('/:id', async (req, res) => {
    try {
        const { data: museum, error } = await supabase
            .from('museums').select('*')
            .eq('id', req.params.id).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!museum) return res.status(404).json({ error: 'Museum not found' })

        const { data: floors, error: fe } = await supabase
            .from('floors').select('*')
            .eq('museum_id', req.params.id)
            .order('floor_number', { ascending: true })
        if (fe) return res.status(500).json({ error: fe.message })

        return res.json({ ...museum, floors: floors || [] })
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /museums/:id
router.put('/:id', async (req, res) => {
    try {
        const { museum_name } = req.body
        if (!museum_name?.trim())
            return res.status(400).json({ error: 'museum_name is required' })

        const { data, error } = await supabase
            .from('museums').update({ museum_name: museum_name.trim() })
            .eq('id', req.params.id).select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Museum not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /museums/:id/regenerate-qr
router.post('/:id/regenerate-qr', async (req, res) => {
    try {
        const { data: museum, error } = await supabase
            .from('museums').select('*').eq('id', req.params.id).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!museum) return res.status(404).json({ error: 'Museum not found' })

        const imageUrl = await generateAndUploadQR(museum.id, museum.museum_name)
        const { data: updated, error: ue } = await supabase
            .from('museums').update({ image: imageUrl })
            .eq('id', museum.id).select().single()
        if (ue) return res.status(500).json({ error: ue.message })
        return res.json(updated)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /museums/:id
router.delete('/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('museums').delete().eq('id', req.params.id)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// FLOORS (nested under museums)
// ─────────────────────────────────────────

// POST /museums/:id/floors
router.post('/:id/floors', upload.single('floor_image'), async (req, res) => {
    try {
        const museumId = req.params.id
        const { data: museum, error: me } = await supabase
            .from('museums').select('id').eq('id', museumId).maybeSingle()
        if (me) return res.status(500).json({ error: me.message })
        if (!museum) return res.status(404).json({ error: 'Museum not found' })

        const floorNumber = parseInt(req.body.floor_number, 10)
        if (isNaN(floorNumber) || floorNumber < 1)
            return res.status(400).json({ error: 'floor_number must be a positive integer' })

        let scale = null
        if (req.body.scale !== undefined && req.body.scale !== '') {
            scale = parseFloat(req.body.scale)
            if (isNaN(scale)) return res.status(400).json({ error: 'scale must be a valid number' })
        }

        let floorImageUrl = null
        if (req.file)
            floorImageUrl = await uploadFloorImage(req.file.buffer, req.file.mimetype, museumId, floorNumber)

        const { data: floor, error: ie } = await supabase
            .from('floors')
            .insert([{
                museum_id: museumId,
                floor_number: floorNumber,
                floor_image: floorImageUrl,
                map_data: req.body.map_data || null,
                scale
            }])
            .select().single()

        if (ie) {
            if (ie.code === '23505')
                return res.status(409).json({ error: `Floor ${floorNumber} already exists for this museum` })
            return res.status(500).json({ error: ie.message })
        }
        return res.status(201).json(floor)
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

// GET /museums/:id/floors
router.get('/:id/floors', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('floors').select('*')
            .eq('museum_id', req.params.id)
            .order('floor_number', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /museums/:id/floors/:floorId
router.get('/:id/floors/:floorId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('floors').select('*')
            .eq('id', req.params.floorId)
            .eq('museum_id', req.params.id)
            .maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Floor not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /museums/:id/floors/:floorId
router.put('/:id/floors/:floorId', upload.single('floor_image'), async (req, res) => {
    try {
        const { data: existing, error: fe } = await supabase
            .from('floors').select('*')
            .eq('id', req.params.floorId)
            .eq('museum_id', req.params.id)
            .maybeSingle()
        if (fe) return res.status(500).json({ error: fe.message })
        if (!existing) return res.status(404).json({ error: 'Floor not found' })

        const updates = {}
        if (req.body.map_data !== undefined) updates.map_data = req.body.map_data
        if (req.body.scale !== undefined && req.body.scale !== '') {
            const scale = parseFloat(req.body.scale)
            if (isNaN(scale)) return res.status(400).json({ error: 'scale must be a valid number' })
            updates.scale = scale
        }
        if (req.file)
            updates.floor_image = await uploadFloorImage(
                req.file.buffer, req.file.mimetype, req.params.id, existing.floor_number)

        if (!Object.keys(updates).length)
            return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('floors').update(updates)
            .eq('id', req.params.floorId).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

// DELETE /museums/:id/floors/:floorId
router.delete('/:id/floors/:floorId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('floors').delete()
            .eq('id', req.params.floorId)
            .eq('museum_id', req.params.id)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

export default router