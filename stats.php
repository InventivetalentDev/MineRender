<?php
header("Access-Control-Allow-Origin: *");

if (!isset($_POST)) {
    return;
}
if (!isset($_POST["action"]) || !isset($_POST["type"])) {
    http_response_code(400);
    return;
}

$action = $_POST["action"];
$type = $_POST["type"];

$host = $_POST["host"];
$source = $_POST["source"];


$json = json_decode(file_get_contents("./stats.json"), true);
if (!isset($json["total"])) die();

$json["total"]++;
if ("javascript" === $source) {
    $json["javascript"]++;
}
if ("iframe" === $source) {
    $json["iframe"]++;
}

if (!isset($json["types"][$type]) && isset($type) && !empty($type)) {
    $json["types"][$type] = 1;
} else {
    $json["types"][$type]++;
}

if (!isset($json["hosts"][$host]) && isset($host) && !empty($host)) {
    $json["hosts"][$host] = 1;
} else {
    $json["hosts"][$host]++;
}


file_put_contents("./stats.json", json_encode($json));