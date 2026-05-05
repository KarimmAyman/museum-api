import { Router } from 'express'
import { supabase } from './supabaseClient.js'

const router = Router()

// ======================
// CREATE museum
// ======================
router.post('/', async (req, res) => {
    try {
        const { museum_name, map_data } = req.body

        if (!museum_name) {
            return res.status(400).json({
                error: 'museum_name is required'
            })
        }

        const { data, error } = await supabase
            .from('museums')
            .insert([{ museum_name, map_data }])
            .select()
            .single()

        if (error) {
            return res.status(500).json({
                error: error.message
            })
        }

        return res.status(201).json(data)

    } catch (err) {
        console.error('POST /museums error:', err)
        return res.status(500).json({
            error: 'Internal server error'
        })
    }
})


// ======================
// GET all museums
// ======================
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('museums')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) {
            return res.status(500).json({
                error: error.message
            })
        }

        return res.json(data)

    } catch (err) {
        console.error('GET /museums error:', err)
        return res.status(500).json({
            error: 'Internal server error'
        })
    }
})


// ======================
// GET by ID
// ======================
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('museums')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle()

        if (error) {
            return res.status(500).json({
                error: error.message
            })
        }

        if (!data) {
            return res.status(404).json({
                error: 'Museum not found'
            })
        }

        return res.json(data)

    } catch (err) {
        console.error('GET /museums/:id error:', err)
        return res.status(500).json({
            error: 'Internal server error'
        })
    }
})


// ======================
// UPDATE museum
// ======================
router.put('/:id', async (req, res) => {
    try {
        const { museum_name, map_data } = req.body

        const updates = {}
        if (museum_name !== undefined) updates.museum_name = museum_name
        if (map_data !== undefined) updates.map_data = map_data

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                error: 'Nothing to update'
            })
        }

        const { data, error } = await supabase
            .from('museums')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .maybeSingle()

        if (error) {
            return res.status(500).json({
                error: error.message
            })
        }

        if (!data) {
            return res.status(404).json({
                error: 'Museum not found'
            })
        }

        return res.json(data)

    } catch (err) {
        console.error('PUT /museums/:id error:', err)
        return res.status(500).json({
            error: 'Internal server error'
        })
    }
})


// ======================
// DELETE museum
// ======================
router.delete('/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('museums')
            .delete()
            .eq('id', req.params.id)

        if (error) {
            return res.status(500).json({
                error: error.message
            })
        }

        return res.status(204).send()

    } catch (err) {
        console.error('DELETE /museums/:id error:', err)
        return res.status(500).json({
            error: 'Internal server error'
        })
    }
})

export default router