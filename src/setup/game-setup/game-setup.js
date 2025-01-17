const assert = require("../../wrapper/assert-wrapper");
const { ApplyScoreboard } = require("./apply-scoreboard");
const { GameSetupUI } = require("./game-setup-ui");
const { globalEvents, world } = require("../../wrapper/api");

let _ui = false;

function onPlayerCountChanged(slider, player, value) {
    world.TI4.config.setPlayerCount(value, player);
}

function onGamePointsChanged(slider, player, value) {
    world.TI4.config.setGamePoints(value);
    new ApplyScoreboard().apply(value);
}

function onUsePokChanged(checkBox, player, isChecked) {
    assert(typeof isChecked === "boolean");
    world.TI4.config.setPoK(isChecked);
}

function onUseOmegaChanged(checkBox, player, isChecked) {
    assert(typeof isChecked === "boolean");
    world.TI4.config.setOmega(isChecked);
}

function onUseCodex1Changed(checkBox, player, isChecked) {
    assert(typeof isChecked === "boolean");
    world.TI4.config.setCodex1(isChecked);
}

function onUseCodex2Changed(checkBox, player, isChecked) {
    assert(typeof isChecked === "boolean");
    world.TI4.config.setCodex2(isChecked);
}

function onSetupClicked(button, player) {
    // Record setup timestamp for gamedata.
    const timestamp = Date.now() / 1000;
    world.TI4.config.setTimestamp(timestamp);

    // Tell world setup happened.
    globalEvents.TI4.onGameSetup.trigger(this._state, player);

    world.removeUI(_ui);
    _ui = false;
}

if (!world.__isMock) {
    process.nextTick(() => {
        if (world.TI4.config.timestamp > 0) {
            return;
        }
        _ui = new GameSetupUI({
            onPlayerCountChanged,
            onGamePointsChanged,
            onUsePokChanged,
            onUseOmegaChanged,
            onUseCodex1Changed,
            onUseCodex2Changed,
            onSetupClicked,
        }).create();
        world.addUI(_ui);
    });
}
