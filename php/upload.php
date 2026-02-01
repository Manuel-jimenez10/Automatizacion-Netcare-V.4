<?php
/**
 * WhatsApp Media Upload Endpoint
 * Recibe archivos desde el backend Node.js y los guarda en el servidor.
 * 
 * Uso: POST /upload.php
 * Params: file (multipart/form-data), token (opcional para seguridad)
 */

header('Content-Type: application/json');

// --- CONFIGURACIÓN ---
$storageDir = __DIR__ . '/storage/whatsapp/'; // Ruta donde se guardarán los archivos
$baseUrl = 'https://' . $_SERVER['HTTP_HOST'] . '/storage/whatsapp/'; // URL pública base
$allowedMimes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/amr',
    'video/mp4', 'video/mpeg',
    'application/pdf'
];
$maxFileSize = 20 * 1024 * 1024; // 20MB
$secretToken = 'CAMBIAR_POR_TOKEN_SEGURO'; // Configurar mismo token en Node.js .env

// --- VALIDACIONES BASICAS ---

// 1. Validar Método
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

// 2. Validar Token (Opcional pero recomendado)
$headers = getallheaders();
$authHeader = isset($headers['Authorization']) ? $headers['Authorization'] : '';
// Descomentar para activar seguridad por token
// if ($authHeader !== 'Bearer ' . $secretToken) {
//     http_response_code(403);
//     echo json_encode(['error' => 'Unauthorized']);
//     exit;
// }

// 3. Validar Archivo
if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'No file uploaded or upload error', 'code' => $_FILES['file']['error'] ?? 'unknown']);
    exit;
}

$file = $_FILES['file'];

// 4. Validar Tamaño
if ($file['size'] > $maxFileSize) {
    http_response_code(413);
    echo json_encode(['error' => 'File too large', 'max_size' => $maxFileSize]);
    exit;
}

// 5. Validar Tipo MIME
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $finfo->file($file['tmp_name']);

if (!in_array($mimeType, $allowedMimes)) {
    http_response_code(415);
    echo json_encode(['error' => 'Unsupported media type', 'mime' => $mimeType]);
    exit;
}

// --- PROCESAMIENTO ---

// Crear directorio si no existe
if (!is_dir($storageDir)) {
    if (!mkdir($storageDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create storage directory']);
        exit;
    }
}

// Generar nombre único
$extension = pathinfo($file['name'], PATHINFO_EXTENSION);
if (!$extension) {
    // Intentar deducir extensión por mime si falta
    $extension = explode('/', $mimeType)[1];
}

$uniqueName = uniqid('wa_', true) . '_' . time() . '.' . $extension;
$destination = $storageDir . $uniqueName;

// Mover archivo
if (move_uploaded_file($file['tmp_name'], $destination)) {
    $publicUrl = $baseUrl . $uniqueName;
    
    // Determinar categoría simple
    $category = 'document';
    if (strpos($mimeType, 'image') === 0) $category = 'image';
    if (strpos($mimeType, 'audio') === 0) $category = 'voice_note';
    if (strpos($mimeType, 'video') === 0) $category = 'video';

    echo json_encode([
        'success' => true,
        'url' => $publicUrl,
        'fileName' => $uniqueName,
        'originalName' => $file['name'],
        'mimeType' => $mimeType,
        'category' => $category,
        'size' => $file['size']
    ]);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write file to disk']);
}
