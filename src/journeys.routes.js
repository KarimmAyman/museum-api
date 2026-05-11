import { Router } from 'express'
import { supabase } from './supabaseClient.js'
import QRCode from 'qrcode'

const router = Router()

async function generateAndUploadJourneyQR(journey) {
    const qrContent = JSON.stringify({
        museum_id: journey.museum_id,
        floor_id: journey.floor_id,
        journey_id: journey.id,
        start_anchor_id: journey.start_anchor_id
    })
    const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png', width: 400, margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
    })
    const fileName = `journey_qr_${journey.id}.png`
    const { error } = await supabase.storage
        .from('museum-qrcodes')
        .upload(fileName, qrBuffer, { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`QR upload failed: ${error.message}`)
    const { data } = supabase.storage.from('museum-qrcodes').getPublicUrl(fileName)
    return data.publicUrl
}

// ─────────────────────────────────────────
// JOURNEYS CRUD
// ─────────────────────────────────────────

// POST /journeys
router.post('/', async (req, res) => {
    try {
        const { museum_id, floor_id, name, start_anchor_id, destination_anchor_id } = req.body
        if (!museum_id) return res.status(400).json({ error: 'museum_id is required' })
        if (!floor_id) return res.status(400).json({ error: 'floor_id is required' })
        if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

        const { data, error } = await supabase
            .from('journeys')
            .insert([{
                museum_id,
                floor_id,
                name: name.trim(),
                start_anchor_id: start_anchor_id || null,
                destination_anchor_id: destination_anchor_id || null
            }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /journeys  (optionally filter by museum_id or floor_id)
router.get('/', async (req, res) => {
    try {
        let query = supabase.from('journeys').select('*').order('created_at', { ascending: false })
        if (req.query.museum_id) query = query.eq('museum_id', req.query.museum_id)
        if (req.query.floor_id) query = query.eq('floor_id', req.query.floor_id)
        const { data, error } = await query
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /journeys/:id  — with route points
router.get('/:id', async (req, res) => {
    try {
        const { data: journey, error } = await supabase
            .from('journeys').select('*').eq('id', req.params.id).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!journey) return res.status(404).json({ error: 'Journey not found' })

        const { data: route, error: re } = await supabase
            .from('route_points').select('*')
            .eq('journey_id', req.params.id)
            .order('order_index', { ascending: true })
        if (re) return res.status(500).json({ error: re.message })

        return res.json({
            success: true,
            journey: {
                ...journey,
                route: (route || []).map(r => ({
                    order: r.order_index,
                    type: r.type,
                    ref_id: r.ref_id,
                    id: r.id
                }))
            }
        })
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /journeys/:id
router.put('/:id', async (req, res) => {
    try {
        const updates = {}
        if (req.body.name !== undefined) updates.name = req.body.name.trim()
        if (req.body.start_anchor_id !== undefined) updates.start_anchor_id = req.body.start_anchor_id || null
        if (req.body.destination_anchor_id !== undefined) updates.destination_anchor_id = req.body.destination_anchor_id || null
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('journeys').update(updates)
            .eq('id', req.params.id).select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Journey not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /journeys/:id
router.delete('/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('journeys').delete().eq('id', req.params.id)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// POST /journeys/:id/generate-qr
router.post('/:id/generate-qr', async (req, res) => {
    try {
        const { data: journey, error } = await supabase
            .from('journeys').select('*').eq('id', req.params.id).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!journey) return res.status(404).json({ error: 'Journey not found' })

        const qrImage = await generateAndUploadJourneyQR(journey)

        const { data: updated, error: ue } = await supabase
            .from('journeys').update({ qr_image: qrImage })
            .eq('id', journey.id).select().single()
        if (ue) return res.status(500).json({ error: ue.message })

        return res.json({
            success: true,
            qr_image: qrImage,
            payload: {
                museum_id: journey.museum_id,
                floor_id: journey.floor_id,
                journey_id: journey.id,
                start_anchor_id: journey.start_anchor_id
            },
            journey: updated
        })
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Internal server error' })
    }
})

// ─────────────────────────────────────────
// ROUTE POINTS
// ─────────────────────────────────────────

// POST /journeys/:id/route-points
router.post('/:id/route-points', async (req, res) => {
    try {
        const { order_index, type, ref_id } = req.body
        const validTypes = ['poi', 'anchor', 'stairs', 'room']
        if (!type || !validTypes.includes(type))
            return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
        if (!ref_id) return res.status(400).json({ error: 'ref_id is required' })

        const { data, error } = await supabase
            .from('route_points')
            .insert([{
                journey_id: req.params.id,
                order_index: parseInt(order_index) || 0,
                type,
                ref_id
            }])
            .select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.status(201).json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// GET /journeys/:id/route-points
router.get('/:id/route-points', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('route_points').select('*')
            .eq('journey_id', req.params.id)
            .order('order_index', { ascending: true })
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// PUT /journeys/:id/route-points/:pointId
router.put('/:id/route-points/:pointId', async (req, res) => {
    try {
        const updates = {}
        const validTypes = ['poi', 'anchor', 'stairs', 'room']
        if (req.body.order_index !== undefined) updates.order_index = parseInt(req.body.order_index)
        if (req.body.type !== undefined) {
            if (!validTypes.includes(req.body.type))
                return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` })
            updates.type = req.body.type
        }
        if (req.body.ref_id !== undefined) updates.ref_id = req.body.ref_id
        if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

        const { data, error } = await supabase
            .from('route_points').update(updates)
            .eq('id', req.params.pointId).eq('journey_id', req.params.id)
            .select().maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        if (!data) return res.status(404).json({ error: 'Route point not found' })
        return res.json(data)
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /journeys/:id/route-points/:pointId
router.delete('/:id/route-points/:pointId', async (req, res) => {
    try {
        const { error } = await supabase
            .from('route_points').delete()
            .eq('id', req.params.pointId).eq('journey_id', req.params.id)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// DELETE /journeys/:id/route-points  (clear all route points)
router.delete('/:id/route-points', async (req, res) => {
    try {
        const { error } = await supabase
            .from('route_points').delete().eq('journey_id', req.params.id)
        if (error) return res.status(500).json({ error: error.message })
        return res.status(204).send()
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

export default router