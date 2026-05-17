import { Router } from 'express'
import { supabase } from './supabaseClient.js'
import { generateRecalibrationQR } from './Stories.routes.js'

const router = Router()

// ============================================================
// POST /import-map
// Body (JSON):
//   {
//     story_id: "uuid",
//     map_json: { ...the full floor JSON object... }
//   }
//
// What it does:
//   1. Validates story exists
//   2. Parses map_json.directions — filters type === 'recalibration'
//   3. For each recalibration point:
//      - Inserts into recalibration_points
//      - Generates and uploads a QR code
//      - Saves QR URL back to the record
//   4. Returns summary of all inserted points with QR URLs
// ============================================================
router.post('/', async (req, res) => {
    try {
        const { story_id, map_json } = req.body

        // ── Validate inputs ───────────────────────────────────
        if (!story_id) return res.status(400).json({ error: 'story_id is required' })
        if (!map_json) return res.status(400).json({ error: 'map_json is required' })

        // ── Validate story exists ─────────────────────────────
        const { data: story, error: se } = await supabase
            .from('stories').select('id, floor_id').eq('id', story_id).maybeSingle()
        if (se) return res.status(500).json({ error: se.message })
        if (!story) return res.status(404).json({ error: 'Story not found' })

        // ── Validate floor and get museum_id ──────────────────
        const { data: floor, error: fe } = await supabase
            .from('floors').select('museum_id').eq('id', story.floor_id).maybeSingle()
        if (fe) return res.status(500).json({ error: fe.message })
        if (!floor) return res.status(404).json({ error: 'Floor not found' })

        // ── Parse map JSON ────────────────────────────────────
        let mapData = map_json
        if (typeof map_json === 'string') {
            try { mapData = JSON.parse(map_json) }
            catch { return res.status(400).json({ error: 'map_json must be valid JSON' }) }
        }

        // ── Extract recalibration directions ──────────────────
        const directions = mapData.directions || []
        const recalibrationDirs = directions
            .map((d, i) => ({ ...d, originalIndex: i }))
            .filter(d => d.type === 'recalibration')

        if (recalibrationDirs.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No recalibration points found in map JSON',
                inserted: 0,
                points: []
            })
        }

        // ── Delete existing recalibration points for this story ─
        await supabase.from('recalibration_points').delete().eq('story_id', story_id)

        // ── Insert each recalibration point + generate QR ──────
        const results = []
        const errors = []

        for (let i = 0; i < recalibrationDirs.length; i++) {
            const dir = recalibrationDirs[i]

            try {
                // Insert point
                const { data: point, error: ie } = await supabase
                    .from('recalibration_points')
                    .insert([{
                        story_id,
                        x: parseFloat(dir.x) || 0,
                        y: parseFloat(dir.y) || 0,
                        rotation: parseFloat(dir.rotation) || 0,
                        order_index: i
                    }])
                    .select().single()

                if (ie) {
                    errors.push({ index: i, error: ie.message })
                    continue
                }

                // Generate QR for this point
                const qrUrl = await generateRecalibrationQR(point, floor.museum_id, story.floor_id)

                // Save QR URL back
                const { data: updated } = await supabase
                    .from('recalibration_points').update({ qr_image: qrUrl })
                    .eq('id', point.id).select().single()

                results.push(updated || point)

            } catch (err) {
                errors.push({ index: i, x: dir.x, y: dir.y, error: err.message })
            }
        }

        return res.status(200).json({
            success: true,
            message: `Processed ${recalibrationDirs.length} recalibration point(s)`,
            inserted: results.length,
            failed: errors.length,
            points: results,
            errors: errors.length > 0 ? errors : undefined
        })

    } catch (err) {
        console.error('POST /import-map error:', err)
        return res.status(500).json({ error: 'Internal server error' })
    }
})

// ============================================================
// GET /import-map/preview
// Body: { map_json }
// Returns recalibration points without inserting — preview only
// ============================================================
router.post('/preview', async (req, res) => {
    try {
        const { map_json } = req.body
        if (!map_json) return res.status(400).json({ error: 'map_json is required' })

        let mapData = map_json
        if (typeof map_json === 'string') {
            try { mapData = JSON.parse(map_json) }
            catch { return res.status(400).json({ error: 'map_json must be valid JSON' }) }
        }

        const directions = mapData.directions || []
        const all = directions.map((d, i) => ({ ...d, originalIndex: i }))
        const recalibration = all.filter(d => d.type === 'recalibration')
        const start = all.filter(d => d.type === 'start')
        const end = all.filter(d => d.type === 'end')
        const normal = all.filter(d => d.type === 'normal')

        return res.json({
            success: true,
            map_id: mapData.id || null,
            map_name: mapData.name || null,
            image: mapData.imagePath || null,
            dimensions: {
                width: mapData.imageWidth,
                height: mapData.imageHeight,
                pixelsPerMeter: mapData.pixelsPerMeter
            },
            summary: {
                total_directions: directions.length,
                recalibration: recalibration.length,
                start: start.length,
                end: end.length,
                normal: normal.length,
                walls: (mapData.walls || []).length,
                obstacles: (mapData.obstacles || []).length,
                circleObstacles: (mapData.circleObstacles || []).length,
            },
            recalibration_points: recalibration.map((d, i) => ({
                order_index: i,
                x: d.x,
                y: d.y,
                rotation: d.rotation,
                original_index: d.originalIndex
            }))
        })
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' })
    }
})

export default router