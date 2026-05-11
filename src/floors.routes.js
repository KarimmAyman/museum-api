import { Router } from 'express'
import { supabase } from './supabaseClient.js'
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

async function uploadPoiImage(buffer, mimetype, floorId) {
    const ext = mimetype.split('/')[1]
    const fileName = `poi_${floorId}_${uuidv4()}.${ext}`
    const { error } = await supabase.storage
        .from('poi-images')
        .upload(fileName, buffer, { contentType: mimetype, upsert: false })
    if (error) throw new Error(`POI image upload failed: ${error.message}`)
    const { data } = supabase.storage.from('poi-images').getPublicUrl(fileName)
    return data.publicUrl
}

// ─────────────────────────────────────────
// GET /floors/:floorId — full floor data
// (the most important endpoint for mobile)
// ─────────────────────────────────────────
router.get('/:floorId', async (req, res) => {
    try {
        const { floorId } = req.params

        const { data: floor, error: fe } = await supabase
            .from('floors').select('*').eq('id', floorId).maybeSingle()
        if (fe) return res.status(500).json({ error: fe.message })
        if (!floor) return res.status(404).json({ error: 'Floor not found' })

        // Fetch all related entities in parallel
        const [rooms, walls, anchors, stairs, pois] = await Promise.all([
            supabase.from('rooms').select('*').eq('floor_id', floorId).order('created_at'),
            supabase.from('walls').select('*').eq('floor_id', floorId).order('created_at'),
            supabase.from('anchors').select('*').eq('floor_id', floorId).order('created_at'),
            supabase.from('stairs').select('*').eq('floor_id', floorId).order('created_at'),
            supabase.from('pois').select('*').eq('floor_id', floorId).order('created_at'),
        ])

        return res.json({
            success: true,
            floor: {
                id: floor.id,
                museum_id: floor.museum_id,
                floor_number: floor.floor_number,
                scale: floor.scale,
                created_at: floor.created_at,
                map: {
                    image_url: floor.floor_image,
                    scale: { meters_per_pixel: floor.scale }
                },
                map_data: floor.map_data,
                rooms: rooms.data || [],
                walls: walls.data || [],
                anchors: anchors.data || [],
                stairs: stairs.data || [],
                pois: pois.data || []
            }
        })
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// ROOMS
// ─────────────────────────────────────────

// POST /floors/:floorId/rooms
router.post('/:floorId/rooms', async (req, res) => {
    try {
        const { name, polygon } = req.body
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

        let parsedPolygon = []
        if (polygon) {
            try { parsedPolygon = typeof polygon === 'string' ? JSON.parse(polygon) : polygon }
            catch { return res.status(400).json({ error: 'polygon must be valid JSON array' }) }
        }

        const { data, error } = await supabase
            .from('rooms')
            .insert([{ floor_id: req.params.floorId, name: name.trim(), polygon: parsedPolygon }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/rooms
router.get('/:floorId/rooms', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('rooms').select('*').eq('floor_id', req.params.floorId).order('created_at')
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/rooms/:roomId
router.get('/:floorId/rooms/:roomId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('rooms').select('*')
            .eq('id', req.params.roomId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Room not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/rooms/:roomId
router.put('/:floorId/rooms/:roomId', async (req, res) => {
    try {
        const updates = {}
        if (req.body.name !== undefined) updates.name = req.body.name.trim()
        if (req.body.polygon !== undefined) {
            try {
                updates.polygon = typeof req.body.polygon === 'string'
                    ? JSON.parse(req.body.polygon) : req.body.polygon
            } catch { return res.status(400).json({ error: 'polygon must be valid JSON array' }) }
        }
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('rooms').update(updates)
            .eq('id', req.params.roomId).eq('floor_id', req.params.floorId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Room not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /floors/:floorId/rooms/:roomId
router.delete('/:floorId/rooms/:roomId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('rooms').delete()
            .eq('id', req.params.roomId).eq('floor_id', req.params.floorId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// WALLS
// ─────────────────────────────────────────

// POST /floors/:floorId/walls
router.post('/:floorId/walls', async (req, res) => {
    try {
        const { points } = req.body
        let parsedPoints = []
        if (points) {
            try { parsedPoints = typeof points === 'string' ? JSON.parse(points) : points }
            catch { return res.status(400).json({ error: 'points must be valid JSON array' }) }
        }

        const { data, error } = await supabase
            .from('walls')
            .insert([{ floor_id: req.params.floorId, points: parsedPoints }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/walls
router.get('/:floorId/walls', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('walls').select('*').eq('floor_id', req.params.floorId).order('created_at')
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/walls/:wallId
router.get('/:floorId/walls/:wallId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('walls').select('*')
            .eq('id', req.params.wallId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Wall not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/walls/:wallId
router.put('/:floorId/walls/:wallId', async (req, res) => {
    try {
        if (req.body.points === undefined) return res.status(400).json({ error: 'Nothing to update' })
        let points
        try { points = typeof req.body.points === 'string' ? JSON.parse(req.body.points) : req.body.points }
        catch { return res.status(400).json({ error: 'points must be valid JSON array' }) }

        const { data, error } = await supabase
            .from('walls').update({ points })
            .eq('id', req.params.wallId).eq('floor_id', req.params.floorId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Wall not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /floors/:floorId/walls/:wallId
router.delete('/:floorId/walls/:wallId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('walls').delete()
            .eq('id', req.params.wallId).eq('floor_id', req.params.floorId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// ANCHORS
// ─────────────────────────────────────────

// POST /floors/:floorId/anchors
router.post('/:floorId/anchors', async (req, res) => {
    try {
        const { name, x, y, heading, type } = req.body
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

        const validTypes = ['entry', 'qr', 'stairs', 'checkpoint']
        if (type && !validTypes.includes(type))
            return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })

        const { data, error } = await supabase
            .from('anchors')
            .insert([{
                floor_id: req.params.floorId,
                name: name.trim(),
                x: parseFloat(x) || 0,
                y: parseFloat(y) || 0,
                heading: parseFloat(heading) || 0,
                type: type || 'entry'
            }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/anchors
router.get('/:floorId/anchors', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('anchors').select('*').eq('floor_id', req.params.floorId).order('created_at')
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/anchors/:anchorId
router.get('/:floorId/anchors/:anchorId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('anchors').select('*')
            .eq('id', req.params.anchorId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Anchor not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/anchors/:anchorId
router.put('/:floorId/anchors/:anchorId', async (req, res) => {
    try {
        const updates = {}
        const validTypes = ['entry', 'qr', 'stairs', 'checkpoint']
        if (req.body.name !== undefined) updates.name = req.body.name.trim()
        if (req.body.x !== undefined) updates.x = parseFloat(req.body.x)
        if (req.body.y !== undefined) updates.y = parseFloat(req.body.y)
        if (req.body.heading !== undefined) updates.heading = parseFloat(req.body.heading)
        if (req.body.type !== undefined) {
            if (!validTypes.includes(req.body.type))
                return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
            updates.type = req.body.type
        }
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('anchors').update(updates)
            .eq('id', req.params.anchorId).eq('floor_id', req.params.floorId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Anchor not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /floors/:floorId/anchors/:anchorId
router.delete('/:floorId/anchors/:anchorId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('anchors').delete()
            .eq('id', req.params.anchorId).eq('floor_id', req.params.floorId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// STAIRS
// ─────────────────────────────────────────

// POST /floors/:floorId/stairs
router.post('/:floorId/stairs', async (req, res) => {
    try {
        const { x, y, target_floor_id } = req.body
        const { data, error } = await supabase
            .from('stairs')
            .insert([{
                floor_id: req.params.floorId,
                x: parseFloat(x) || 0,
                y: parseFloat(y) || 0,
                target_floor_id: target_floor_id || null
            }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/stairs
router.get('/:floorId/stairs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('stairs').select('*').eq('floor_id', req.params.floorId).order('created_at')
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/stairs/:stairId
router.get('/:floorId/stairs/:stairId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('stairs').select('*')
            .eq('id', req.params.stairId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Stair not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/stairs/:stairId
router.put('/:floorId/stairs/:stairId', async (req, res) => {
    try {
        const updates = {}
        if (req.body.x !== undefined) updates.x = parseFloat(req.body.x)
        if (req.body.y !== undefined) updates.y = parseFloat(req.body.y)
        if (req.body.target_floor_id !== undefined) updates.target_floor_id = req.body.target_floor_id || null
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('stairs').update(updates)
            .eq('id', req.params.stairId).eq('floor_id', req.params.floorId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Stair not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /floors/:floorId/stairs/:stairId
router.delete('/:floorId/stairs/:stairId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('stairs').delete()
            .eq('id', req.params.stairId).eq('floor_id', req.params.floorId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// POIs
// ─────────────────────────────────────────

// POST /floors/:floorId/pois  (supports image upload)
router.post('/:floorId/pois', upload.array('images', 10), async (req, res) => {
    try {
        const { name, description, x, y, audio_url } = req.body
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

        // Upload images if provided
        let imageUrls = []
        if (req.files && req.files.length > 0) {
            imageUrls = await Promise.all(
                req.files.map(f => uploadPoiImage(f.buffer, f.mimetype, req.params.floorId))
            )
        }

        // Also accept image URLs as JSON string
        if (req.body.image_urls) {
            try {
                const extra = JSON.parse(req.body.image_urls)
                imageUrls = [...imageUrls, ...extra]
            } catch { /* ignore */ }
        }

        const { data, error } = await supabase
            .from('pois')
            .insert([{
                floor_id: req.params.floorId,
                name: name.trim(),
                description: description || null,
                x: parseFloat(x) || 0,
                y: parseFloat(y) || 0,
                images: imageUrls,
                audio_url: audio_url || null
            }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

// GET /floors/:floorId/pois
router.get('/:floorId/pois', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('pois').select('*').eq('floor_id', req.params.floorId).order('created_at')
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/pois/:poiId
router.get('/:floorId/pois/:poiId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('pois').select('*')
            .eq('id', req.params.poiId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'POI not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/pois/:poiId
router.put('/:floorId/pois/:poiId', upload.array('images', 10), async (req, res) => {
    try {
        const updates = {}
        if (req.body.name !== undefined) updates.name = req.body.name.trim()
        if (req.body.description !== undefined) updates.description = req.body.description
        if (req.body.x !== undefined) updates.x = parseFloat(req.body.x)
        if (req.body.y !== undefined) updates.y = parseFloat(req.body.y)
        if (req.body.audio_url !== undefined) updates.audio_url = req.body.audio_url

        if (req.files && req.files.length > 0) {
            const newUrls = await Promise.all(
                req.files.map(f => uploadPoiImage(f.buffer, f.mimetype, req.params.floorId))
            )
            // Fetch existing images and append
            const { data: existing } = await supabase
                .from('pois').select('images').eq('id', req.params.poiId).single()
            updates.images = [...(existing?.images || []), ...newUrls]
        }

        if (req.body.images !== undefined) {
            try { updates.images = JSON.parse(req.body.images) }
            catch { return res.status(400).json({ error: 'images must be valid JSON array' }) }
        }

        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('pois').update(updates)
            .eq('id', req.params.poiId).eq('floor_id', req.params.floorId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'POI not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

// DELETE /floors/:floorId/pois/:poiId
router.delete('/:floorId/pois/:poiId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('pois').delete()
            .eq('id', req.params.poiId).eq('floor_id', req.params.floorId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

export default router