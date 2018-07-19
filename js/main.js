var JQUERY_VERSION = "3.3.1";
var THREE_VERSION = "94";
var JQUERY_HASH = "sha256-FgpCb/KJQlLNfOu91ta32o/NMZxltwRo8QtmkMRdAu8=";
var THREE_HASH = "sha256-NGC9JEuTWN4GhTj091wctgjzftr+8WNDmw0H8J5YPYE=";

$(".jquery-version").text(JQUERY_VERSION);
$(".three-version").text(THREE_VERSION);
$(".jquery-hash").text(JQUERY_HASH);
$(".three-hash").text(THREE_HASH);


// Showcases


var randomSkins;
var randomBlocks;
var randomItems;
var randomResourcePacks;

function getRandomSkin() {
    var skin = randomSkins.splice(Math.floor(Math.random() * randomSkins.length), 1)[0];
    if (skin.indexOf("|") !== -1) {
        var split = skin.split("|");
        return {
            name: split[0],
            skin: split[1]
        }
    }
    return {
        name: skin,
        skin: skin
    }
}

function getRandomBlock() {
    return randomBlocks.splice(Math.floor(Math.random() * randomBlocks.length), 1)[0];
}

function getRandomItem() {
    return randomItems.splice(Math.floor(Math.random() * randomItems.length), 1)[0];
}

function getRandomResourcePack() {
    return randomResourcePacks.splice(Math.floor(Math.random() * randomResourcePacks.length), 1)[0];
}

function renderSkinShowcases() {
    var renders = [];
    for (var i = 0; i < 3; i++) {
        var skin = getRandomSkin();
        var element = $("#skinExample" + (i + 1));
        $("#skinName" + (i + 1)).text(skin.name)
        var skinRender = new SkinRender({
            autoResize: true,
            canvas: {
                width: element[0].offsetWidth,
                height: element[0].offsetHeight
            },
            render: {
                taa: true
            },
            controls: {
                enabled: true,
                zoom: false,
                rotate: true,
                pan: true
            }
        }, element[0]);
        element.on("skinRender", function (e) {
            if (e.detail.playerModel) {
                e.detail.playerModel.rotation.y += 0.01;
                e.detail.playerModel.children[2].rotation.z = -0.1;
                e.detail.playerModel.children[3].rotation.z = 0.1;
                e.detail.playerModel.children[6].rotation.x = 0.1;
            }
        })
        renders[i] = skinRender;
        (function (i) {
            let data = {
                capeUrl: "https://minerender.org/img/optifine_cape.png",
                optifine: true
            };
            if (skin.skin.length > 16) {
                data.data = skin.skin;
            } else {
                data.username = skin.skin;
            }
            skinRender.render(data, function () {
                $("#skinPlaceholder" + (i + 1)).remove();
            })
        })(i);
    }
}

function renderBlockShowcases() {
    var renders = [];
    for (var i = 0; i < 3; i++) {
        var block = getRandomBlock();
        var element = $("#blockExample" + (i + 1));
        $("#blockName" + (i + 1)).text(block);
        $("#blockName" + (i + 1)).parent().attr("href", "https://github.com/InventivetalentDev/minecraft-assets/blob/1.13/assets/minecraft/blockstates/" + block + ".json")
        var modelRender = new ModelRender({
            autoResize: true,
            canvas: {
                width: element[0].offsetWidth,
                height: element[0].offsetHeight
            },
            centerCubes: true,
            controls: {
                enabled: true,
                zoom: false,
                rotate: true,
                pan: true
            }
        }, element[0]);
        (function (i) {
            modelRender.render([{
                blockstate: block
            }], function () {
                $("#blockPlaceholder" + (i + 1)).remove();
            })
        })(i);
        element.on("modelRender", function (e) {
            let models = e.detail.models;
            for (var j = 0; j < models.length; j++) {
                models[j].rotation.y += 0.01;
            }
        })
        renders[i] = modelRender;
    }
}


function renderItemShowcases() {
    var renders = [];
    for (var i = 0; i < 3; i++) {
        var item = getRandomItem();
        var element = $("#itemExample" + (i + 1));
        $("#itemName" + (i + 1)).text(item);
        $("#itemName" + (i + 1)).parent().attr("href", "https://github.com/InventivetalentDev/minecraft-assets/blob/1.13/assets/minecraft/models/item/" + item + ".json")
        var modelRender = new ModelRender({
            autoResize: true,
            canvas: {
                width: element[0].offsetWidth,
                height: element[0].offsetHeight
            },
            centerCubes: true,
            controls: {
                enabled: true,
                zoom: false,
                rotate: true,
                pan: true
            }
        }, element[0]);
        (function (i) {
            modelRender.render(["item/" + item], function () {
                $("#itemPlaceholder" + (i + 1)).remove();
            })
        })(i);
        element.on("modelRender", function (e) {
            let models = e.detail.models;
            for (var j = 0; j < models.length; j++) {
                models[j].rotation.y += 0.01;
            }
        })
        renders[i] = modelRender;
    }
}

function renderGUIShowcases() {
    var renders = [];
    for (var i = 0; i < 2; i++) {
        var gui = guis[i];
        var element = $("#guiExample" + (i + 1));
        var guiRender = new GuiRender({
            autoResize: true,
            canvas: {
                width: element[0].offsetWidth,
                height: element[0].offsetHeight
            },
            controls: {
                enabled: true,
                zoom: false,
                rotate: false,
                pan: true
            }
        }, element[0]);
        (function (i) {
            guiRender.render(gui, function () {
                $("#guiPlaceholder" + (i + 1)).remove();
            })
        })(i);
        renders[i] = guiRender;
    }
}

function renderRecipeShowcases() {
    for (var i = 0; i < 2; i++) {
        var recipe = recipes[i];
        var element = $("#recipeExample" + (i + 1));
        (function (i, recipe, element) {
            $.ajax("https://minerender.org/res/mc/data/minecraft/recipes/" + recipe.recipe).done(function (r) {
                var guiRender = new GuiRender({
                    autoResize: true,
                    canvas: {
                        width: element[0].offsetWidth,
                        height: element[0].offsetHeight
                    },
                    controls: {
                        enabled: true,
                        zoom: false,
                        rotate: false,
                        pan: true
                    }
                }, element[0]);
                guiRender.render(GuiRender.Helper.recipe(r, recipe.map), function () {
                    $("#recipePlaceholder" + (i + 1)).remove();
                })
            });
        })(i, recipe, element);
    }
}

function renderResourcePackShowcases() {
    var renders = [];
    for (var i = 0; i < 3; i++) {
        var pack = getRandomResourcePack();
        var block = getRandomBlock();
        var element = $("#resourcepackExample" + (i + 1));
        $("#resourcepackName" + (i + 1)).text(pack.name + " / " + block);
        $("#resourcepackName" + (i + 1)).parent().attr("href", pack.url)
        var modelRender = new ModelRender({
            autoResize: true,
            canvas: {
                width: element[0].offsetWidth,
                height: element[0].offsetHeight
            },
            centerCubes: true,
            controls: {
                enabled: true,
                zoom: false,
                rotate: true,
                pan: true
            },
            assetRoot: "/res/rp/" + pack.path
        }, element[0]);
        (function (i) {
            modelRender.render([{
                blockstate: block
            }], function () {
                $("#resourcepackPlaceholder" + (i + 1)).remove();
            })
        })(i);
        element.on("modelRender", function (e) {
            let models = e.detail.models;
            for (var j = 0; j < models.length; j++) {
                models[j].rotation.y += 0.01;
            }
        })
        renders[i] = modelRender;
    }
}

function openSkinModal() {
    $("#skin-modal").modal();

    var skin = getRandomSkin();
    $("#js-example-skin").text(skin.name);
    $("#iframe-example-skin").text(skin.name);

    $("#skin-modal").modal("open");
}


function openBlockModal() {
    $("#block-modal").modal();

    var block = getRandomBlock();
    $("#js-example-block").text(block);
    $("#iframe-example-block").text(block);

    $("#block-modal").modal("open");
}


function openItemModal() {
    $("#item-modal").modal();

    var item = getRandomItem();
    $("#js-example-item").text(item);
    $("#iframe-example-item").text(item);

    $("#item-modal").modal("open");
}

function openGuiModal() {
    $("#gui-modal").modal();

    $("#gui-modal").modal("open");
}

function openRecipeModal() {
    $("#recipe-modal").modal();

    $("#recipe-modal").modal("open");
}

$(document).ready(function () {
    console.log("Document is ready!")

    randomSkins = skins.splice(0);
    randomBlocks = blocks.splice(0);
    randomItems = items.splice(0);
    randomResourcePacks = resourcePacks.splice(0);

    setTimeout(function () {
        renderSkinShowcases();
        renderBlockShowcases();
        renderItemShowcases();
        renderGUIShowcases();
        renderRecipeShowcases();
        renderResourcePackShowcases();
    }, 500);


    // Modal functions


    $(".skinInstructions").click(openSkinModal);
    $(".blockInstructions").click(openBlockModal);
    $(".itemInstructions").click(openItemModal);
    $(".guiInstructions").click(openGuiModal);
    $(".recipeInstructions").click(openRecipeModal);


    $("pre").click(function () {
        SelectText(this);
    });

    /// https://stackoverflow.com/a/8803160/6257838
    function SelectText(text) {
        if (document.body.createTextRange) { // ms
            var range = document.body.createTextRange();
            range.moveToElementText(text);
            range.select();
        } else if (window.getSelection) {
            var selection = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(text);
            selection.removeAllRanges();
            selection.addRange(range);

        }
    }
})