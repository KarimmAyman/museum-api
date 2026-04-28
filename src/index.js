import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import museumsRouter from './museums.routes.js'

const app = express()

// ========================
// Middlewares
// ========================
app.use(cors())
app.use(express.json())

// ========================
// Health check route
// ========================
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'API is running' })
})

// ========================
// Routes
// ========================
app.use('/museums', museumsRouter)

// ========================
// Handle 404 routes
// ========================
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found'
    })
})

// ========================
// Global error handler
// ========================
app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err)

    res.status(500).json({
        error: 'Internal server error'
    })
})

// ========================
// Start server
// ========================
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`)
})