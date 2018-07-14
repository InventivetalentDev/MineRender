<?php

header("Access-Control-Allow-Origin: *");

if (!$_GET["url"]) {
    die(404);
}

$ch = curl_init($_GET["url"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_VERBOSE, 1);
curl_setopt($ch, CURLOPT_HEADER, 1);
$response = curl_exec($ch);
$info = curl_getinfo($ch);

$header_size = $info["header_size"];
$header = substr($response, 0, $header_size);
$body = substr($response, $header_size);
curl_close($ch);

$data = explode("\n", $header);
//$headers['status'] = $data[0];
array_shift($data);
foreach ($data as $part) {
    $middle = explode(": ", $part, 2);
    if (count($middle) !== 2) continue;
    $headers[trim($middle[0])] = trim($middle[1]);
}
foreach ($headers as $k => $v) {
    header($k . ": " . $v);
}
echo $body;