import { Router } from 'express'
import { supabase } from './supabaseClient.js'
import QRCode from 'qrcode'

const router = Router({ mergeParams: true }) // gets floor_id from parent

// ─────────────────────────────────────────
// HELPER: Generate and upload story QR
// payload: { story_id, floor_id }
// ─────────────────────────────────────────
async function generateStoryQR(story, museumId) {
    const qrContent = JSON.stringify({
        museum_id: museumId,
        floor_id: story.floor_id,
        story_id: story.id
    })
    const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png', width: 400, margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
    })
    const fileName = `story_qr_${story.id}.png`
    const { error } = await supabase.storage
        .from('story-qrcodes')
        .upload(fileName, qrBuffer, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`Story QR upload failed: ${error.message}`)
    const { data } = supabase.storage.from('story-qrcodes').getPublicUrl(fileName)
    return data.publicUrl
}

// ─────────────────────────────────────────
// HELPER: Generate and upload recalibration QR
// payload: { point_id, story_id, x, y, rotation }
// ─────────────────────────────────────────
async function generateRecalibrationQR(point, museumId, floorId) {
    const qrContent = JSON.stringify({
        museum_id: museumId,
        floor_id: floorId,
        point_id: point.id,
        story_id: point.story_id,
        x: point.x,
        y: point.y,
        rotation: point.rotation
    })
    const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png', width: 400, margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
    })
    const fileName = `recal_qr_${point.id}.png`
    const { error } = await supabase.storage
        .from('recalibration-qrcodes')
        .upload(fileName, qrBuffer, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`Recalibration QR upload failed: ${error.message}`)
    const { data } = supabase.storage.from('recalibration-qrcodes').getPublicUrl(fileName)
    return data.publicUrl
}

// ============================================================
// STORIES CRUD
// Base: /floors/:floorId/stories
// ============================================================

// POST /floors/:floorId/stories — Create story, auto-generate story QR
router.post('/', async (req, res) => {
    try {
        const { floorId } = req.params
        const { name } = req.body
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

        // Validate floor exists
        const { data: floor, error: fe } = await supabase
            .from('floors').select('id').eq('id', floorId).maybeSingle()
        if (fe) return res.status(500).json({ error: fe.message })
        if (!floor) return res.status(404).json({ error: 'Floor not found' })

        // Insert story
        const { data: story, error: ie } = await supabase
            .from('stories')
            .insert([{ floor_id: floorId, name: name.trim() }])
            .select().single()
        if (ie) return res.status(500).json({ error: ie.message })

        // Auto-generate story QR
        try {
            const qrUrl = await generateStoryQR(story, req.params.museumId)
            const { data: updated } = await supabase
                .from('stories').update({ qr_image: qrUrl })
                .eq('id', story.id).select().single()
            return res.status(201).json(updated || story)
        } catch (qrErr) {
            console.error('Story QR error (non-fatal):', qrErr.message)
            return res.status(201).json(story)
        }
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/stories — List all stories for a floor (with recal points)
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('stories').select('*')
            .eq('floor_id', req.params.floorId)
            .order('created_at', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/stories/:storyId — Get story with recalibration points
router.get('/:storyId', async (req, res) => {
    try {
        const { data: story, error } = await supabase
            .from('stories').select('*')
            .eq('id', req.params.storyId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!story) return res.status(404).json({ error: 'Story not found' })

        const { data: points, error: pe } = await supabase
            .from('recalibration_points').select('*')
            .eq('story_id', req.params.storyId)
            .order('order_index', { ascending: true })
        if (pe) return res.status(500).json({ error: pe.message })

        return res.json({ ...story, recalibration_points: points || [] })
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})
// GET /floors/:floorId/stories/:storyId/full — Get full story data with floor and museum context
router.get('/:storyId/full', async (req, res) => {
    try {
        const { data: story, error } = await supabase
            .from('stories')
            .select(`
                *,
                recalibration_points (*),
                floors (
                    *,
                    museums (*)
                )
            `)
            .eq('id', req.params.storyId)
            .eq('floor_id', req.params.floorId)
            .maybeSingle()
            
        if (error) return res.status(500).json({ error: error.message })
        if (!story) return res.status(404).json({ error: 'Story not found' })

        // Sort recalibration points by order_index
        if (story.recalibration_points) {
            story.recalibration_points.sort((a, b) => a.order_index - b.order_index)
        }

        return res.json(story)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/stories/:storyId — Update story name
router.put('/:storyId', async (req, res) => {
    try {
        const { name } = req.body
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

        const { data, error } = await supabase
            .from('stories').update({ name: name.trim() })
            .eq('id', req.params.storyId).eq('floor_id', req.params.floorId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Story not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /floors/:floorId/stories/:storyId
router.delete('/:storyId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('stories').delete()
            .eq('id', req.params.storyId).eq('floor_id', req.params.floorId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /floors/:floorId/stories/:storyId/regenerate-qr
router.post('/:storyId/regenerate-qr', async (req, res) => {
    try {
        const { data: story, error } = await supabase
            .from('stories').select('*')
            .eq('id', req.params.storyId).eq('floor_id', req.params.floorId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!story) return res.status(404).json({ error: 'Story not found' })

        const qrUrl = await generateStoryQR(story, req.params.museumId)
        const { data: updated, error: ue } = await supabase
            .from('stories').update({ qr_image: qrUrl })
            .eq('id', story.id).select().single()
        if (ue) return res.status(500).json({ error: ue.message })
        return res.json(updated)
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

// ============================================================
// RECALIBRATION POINTS
// Base: /floors/:floorId/stories/:storyId/recalibration-points
// ============================================================

// POST /floors/:floorId/stories/:storyId/recalibration-points — Add single point + auto QR
router.post('/:storyId/recalibration-points', async (req, res) => {
    try {
        const { x, y, rotation, order_index } = req.body

        const { data: point, error: ie } = await supabase
            .from('recalibration_points')
            .insert([{
                story_id: req.params.storyId,
                x: parseFloat(x) || 0,
                y: parseFloat(y) || 0,
                rotation: parseFloat(rotation) || 0,
                order_index: parseInt(order_index) || 0
            }])
            .select().single()
        if (ie) return res.status(500).json({ error: ie.message })

        // Auto-generate QR for this point
        try {
            const qrUrl = await generateRecalibrationQR(point, req.params.museumId, req.params.floorId)
            const { data: updated } = await supabase
                .from('recalibration_points').update({ qr_image: qrUrl })
                .eq('id', point.id).select().single()
            return res.status(201).json(updated || point)
        } catch (qrErr) {
            console.error('Recal QR error (non-fatal):', qrErr.message)
            return res.status(201).json(point)
        }
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /floors/:floorId/stories/:storyId/recalibration-points
router.get('/:storyId/recalibration-points', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('recalibration_points').select('*')
            .eq('story_id', req.params.storyId)
            .order('order_index', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /floors/:floorId/stories/:storyId/recalibration-points/:pointId
router.put('/:storyId/recalibration-points/:pointId', async (req, res) => {
    try {
        const updates = {}
        if (req.body.x !== undefined) updates.x = parseFloat(req.body.x)
        if (req.body.y !== undefined) updates.y = parseFloat(req.body.y)
        if (req.body.rotation !== undefined) updates.rotation = parseFloat(req.body.rotation)
        if (req.body.order_index !== undefined) updates.order_index = parseInt(req.body.order_index)
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('recalibration_points').update(updates)
            .eq('id', req.params.pointId).eq('story_id', req.params.storyId)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Point not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /floors/:floorId/stories/:storyId/recalibration-points/:pointId
router.delete('/:storyId/recalibration-points/:pointId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('recalibration_points').delete()
            .eq('id', req.params.pointId).eq('story_id', req.params.storyId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE ALL /floors/:floorId/stories/:storyId/recalibration-points
router.delete('/:storyId/recalibration-points', async (req, res) => {
    try {
        const { error } = await supabase
            .from('recalibration_points').delete().eq('story_id', req.params.storyId)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// POST regenerate QR for single recalibration point
router.post('/:storyId/recalibration-points/:pointId/regenerate-qr', async (req, res) => {
    try {
        const { data: point, error } = await supabase
            .from('recalibration_points').select('*')
            .eq('id', req.params.pointId).eq('story_id', req.params.storyId).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!point) return res.status(404).json({ error: 'Point not found' })

        const qrUrl = await generateRecalibrationQR(point, req.params.museumId, req.params.floorId)
        const { data: updated, error: ue } = await supabase
            .from('recalibration_points').update({ qr_image: qrUrl })
            .eq('id', point.id).select().single()
        if (ue) return res.status(500).json({ error: ue.message })
        return res.json(updated)
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

export { generateRecalibrationQR, generateStoryQR }
export default router