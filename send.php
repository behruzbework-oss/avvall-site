<?php
// AVVALL sayt formasi: so'rovni leads/ papkaga yozadi va (agar $TO berilsa) emailga yuboradi.
$TO = ''; // masalan: 'info@avvall.uz'
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !empty($_POST['manzil'])) { http_response_code(400); echo '{"ok":false}'; exit; }
$f = function($k,$n=300){ return mb_substr(trim(strip_tags($_POST[$k] ?? '')),0,$n); };
$ism=$f('ism',120); $tel=$f('telefon',40); $co=$f('kompaniya',160); $msg=$f('loyiha',2000);
if ($ism==='' || strlen(preg_replace('/\D/','',$tel))<9) { http_response_code(422); echo '{"ok":false}'; exit; }
$row = [date('Y-m-d H:i:s'), $ism, $tel, $co, str_replace(["\r","\n"],' ',$msg), $_SERVER['REMOTE_ADDR'] ?? ''];
$dir = __DIR__.'/leads'; if (!is_dir($dir)) mkdir($dir,0750,true);
$fp = fopen($dir.'/sorovlar.csv','a'); if ($fp){ fputcsv($fp,$row); fclose($fp); }
if ($TO) { @mail($TO, '=?UTF-8?B?'.base64_encode('AVVALL: yangi so\'rov — '.$ism).'?=', "Ism: $ism\nTelefon: $tel\nKompaniya: $co\n\n$msg", "Content-Type: text/plain; charset=UTF-8\r\nFrom: noreply@".($_SERVER['HTTP_HOST'] ?? 'localhost')); }
echo '{"ok":true}';
