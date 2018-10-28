<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header("Access-Control-Allow-Headers: X-Requested-With");

$json = file_get_contents('https://api.mojang.com/users/profiles/minecraft/' . $_REQUEST["name"]);
header("Content-Type: application/json");
if (!empty($json)) {
    $data = json_decode($json, true);
    if (is_array($data) and !empty($data)) {
        echo json_encode($data);
        exit();
    }
}

echo json_encode(array(
    "name" => $_REQUEST["name"],
    "id" => null
));