# Goia Museum API Reference

**Base URL:** `https://museum-api-production-4bfe.up.railway.app`

---

## 🏛️ Museums

### List All Museums
```
GET /museums
```
**Returns:**
```json
[
  {
    "id": "museum-uuid",
    "museum_name": "المتحف المصري الكبير",
    "image": "https://.../museum_image.jpg",
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

---

### Get Museum (with floors list)
```
GET /museums/:museumId
```
**Returns:**
```json
{
  "id": "museum-uuid",
  "museum_name": "المتحف المصري الكبير",
  "image": "https://.../museum_image.jpg",
  "floors": [
    {
      "id": "floor-uuid",
      "floor_number": 1,
      "floor_image": "https://.../floor.jpg",
      "map_data": "{...}",
      "qr_image": "https://.../floor_qr.png"
    }
  ]
}
```

---

### Get Full Museum (floors + stories nested)
```
GET /museums/:museumId/full
```
**Returns:**
```json
{
  "id": "museum-uuid",
  "museum_name": "المتحف المصري الكبير",
  "image": "https://.../museum_image.jpg",
  "floors": [
    {
      "id": "floor-uuid",
      "floor_number": 1,
      "floor_image": "https://.../floor.jpg",
      "map_data": "{\"walls\": [...]}",
      "qr_image": "https://.../floor_qr.png",
      "stories": [
        {
          "id": "story-uuid",
          "name": "مسار المومياوات",
          "qr_image": "https://.../story_qr.png",
          "created_at": "2024-05-18T12:00:00Z"
        }
      ]
    }
  ]
}
```

---

### Create Museum
```
POST /museums
Content-Type: multipart/form-data
```
| Field | Type | Required |
|-------|------|----------|
| `museum_name` | string | ✅ |
| `image` | file (image) | ❌ |

**Returns:** `201` — Created museum object.

---

### Update Museum
```
PUT /museums/:museumId
Content-Type: multipart/form-data
```
| Field | Type | Required |
|-------|------|----------|
| `museum_name` | string | ❌ |
| `image` | file (image) | ❌ |

**Returns:** Updated museum object.

---

### Delete Museum
```
DELETE /museums/:museumId
```
**Returns:** `204 No Content`

---

## 🏢 Floors

### List Floors for a Museum
```
GET /museums/:museumId/floors
```
**Returns:**
```json
[
  {
    "id": "floor-uuid",
    "museum_id": "museum-uuid",
    "floor_number": 1,
    "floor_image": "https://.../floor.jpg",
    "map_data": "{...}",
    "qr_image": "https://.../floor_qr.png"
  }
]
```

---

### Get Single Floor
```
GET /museums/:museumId/floors/:floorId
```
**Returns:** Single floor object (same shape as above).

---

### Create Floor
```
POST /museums/:museumId/floors
Content-Type: multipart/form-data
```
| Field | Type | Required |
|-------|------|----------|
| `floor_number` | integer | ✅ |
| `floor_image` | file (image) | ❌ |
| `map_data` | JSON string | ❌ |

**Returns:** `201` — Created floor with auto-generated QR code.

---

### Update Floor
```
PUT /museums/:museumId/floors/:floorId
Content-Type: multipart/form-data
```
| Field | Type | Required |
|-------|------|----------|
| `floor_number` | integer | ❌ |
| `floor_image` | file (image) | ❌ |
| `map_data` | JSON string | ❌ |

**Returns:** Updated floor object.

---

### Delete Floor
```
DELETE /museums/:museumId/floors/:floorId
```
**Returns:** `204 No Content`

---

### Regenerate Floor QR Code
```
POST /museums/:museumId/floors/:floorId/regenerate-qr
```
**Returns:** Updated floor with new `qr_image` URL.

---

## 📖 Stories

### List Stories for a Floor
```
GET /museums/:museumId/floors/:floorId/stories
```
**Returns:**
```json
[
  {
    "id": "story-uuid",
    "floor_id": "floor-uuid",
    "name": "مسار المومياوات",
    "qr_image": "https://.../story_qr.png",
    "created_at": "2024-05-18T12:00:00Z"
  }
]
```

---

### Get Story (with recalibration points)
```
GET /museums/:museumId/floors/:floorId/stories/:storyId
```
**Returns:**
```json
{
  "id": "story-uuid",
  "floor_id": "floor-uuid",
  "name": "مسار المومياوات",
  "qr_image": "https://.../story_qr.png",
  "created_at": "2024-05-18T12:00:00Z",
  "recalibration_points": [
    { "id": "point1-uuid", "story_id": "story-uuid", "x": 10.5, "y": 20.1, "rotation": 90, "order_index": 0, "qr_image": "https://.../recal1_qr.png" },
    { "id": "point2-uuid", "story_id": "story-uuid", "x": 15.0, "y": 25.5, "rotation": 180, "order_index": 1, "qr_image": "https://.../recal2_qr.png" }
  ]
}
```

---

### ⭐ Get Full Story (story + recal points + floor + museum)
```
GET /museums/:museumId/floors/:floorId/stories/:storyId/full
```
> **Main endpoint for the mobile AR app.** Returns the complete nested hierarchy in a single call.

**Returns:**
```json
{
  "id": "story-uuid",
  "floor_id": "floor-uuid",
  "name": "مسار المومياوات",
  "qr_image": "https://.../story_qr.png",
  "created_at": "2024-05-18T12:00:00Z",
  "recalibration_points": [
    { "id": "point1-uuid", "story_id": "story-uuid", "x": 10.5, "y": 20.1, "rotation": 90, "order_index": 0, "qr_image": "https://.../recal1_qr.png" },
    { "id": "point2-uuid", "story_id": "story-uuid", "x": 15.0, "y": 25.5, "rotation": 180, "order_index": 1, "qr_image": "https://.../recal2_qr.png" }
  ],
  "floors": {
    "id": "floor-uuid",
    "museum_id": "museum-uuid",
    "floor_number": 1,
    "floor_image": "https://.../floor_image.jpg",
    "map_data": "{\"walls\": [...]}",
    "qr_image": "https://.../floor_qr.png",
    "museums": {
      "id": "museum-uuid",
      "museum_name": "المتحف المصري الكبير",
      "image": "https://.../museum_image.jpg"
    }
  }
}
```

---

### Create Story
```
POST /museums/:museumId/floors/:floorId/stories
Content-Type: application/json
```
```json
{ "name": "مسار المومياوات" }
```
**Returns:** `201` — Created story with auto-generated QR code.

---

### Update Story
```
PUT /museums/:museumId/floors/:floorId/stories/:storyId
Content-Type: application/json
```
```json
{ "name": "اسم جديد" }
```
**Returns:** Updated story object.

---

### Delete Story
```
DELETE /museums/:museumId/floors/:floorId/stories/:storyId
```
**Returns:** `204 No Content`

---

### Regenerate Story QR Code
```
POST /museums/:museumId/floors/:floorId/stories/:storyId/regenerate-qr
```
**Returns:** Updated story with new `qr_image` URL.

---

## 📍 Recalibration Points

### List Points for a Story
```
GET /museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points
```
**Returns:** Array of points sorted by `order_index`.
```json
[
  { "id": "point-uuid", "story_id": "story-uuid", "x": 10.5, "y": 20.1, "rotation": 90, "order_index": 0, "qr_image": "https://..." }
]
```

---

### Add a Recalibration Point
```
POST /museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points
Content-Type: application/json
```
```json
{ "x": 10.5, "y": 20.1, "rotation": 90, "order_index": 0 }
```
**Returns:** `201` — Created point with auto-generated QR code.

---

### Update a Recalibration Point
```
PUT /museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points/:pointId
Content-Type: application/json
```
```json
{ "x": 11.0, "y": 21.0, "rotation": 0, "order_index": 1 }
```
**Returns:** Updated point object.

---

### Delete a Single Point
```
DELETE /museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points/:pointId
```
**Returns:** `204 No Content`

---

### Delete ALL Points for a Story
```
DELETE /museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points
```
**Returns:** `204 No Content`

---

### Regenerate Point QR Code
```
POST /museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points/:pointId/regenerate-qr
```
**Returns:** Updated point with new `qr_image` URL.

---

## 🗺️ Import Map

### Import Recalibration Points from JSON
```
POST /import-map
Content-Type: application/json
```
**Body:**
```json
{
  "story_id": "story-uuid",
  "museum_id": "museum-uuid",
  "floor_id": "floor-uuid",
  "recalibrationPoints": [
    { "x": 10.5, "y": 20.1, "rotation": 90, "order_index": 0 },
    { "x": 15.0, "y": 25.5, "rotation": 180, "order_index": 1 }
  ]
}
```
**Returns:**
```json
{ "message": "Imported 2 points successfully", "points": [...] }
```

---

## ❌ Error Format

All errors follow this shape:
```json
{ "error": "Descriptive error message here" }
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request / missing required field |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate floor number) |
| `500` | Internal server error |
