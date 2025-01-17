const assert = require("../../wrapper/assert-wrapper");
const locale = require("../locale");
const { AuxData } = require("../unit/auxdata");
const { RollGroup } = require("../dice/roll-group");
const { UnitDieBuilder } = require("../dice/unit-die");
const { Player } = require("../../wrapper/api");
const { Broadcast } = require("../broadcast");

/**
 * Let players manually enter unit counts.
 */
class CombatRoller {
    constructor(auxData, rollType, player) {
        assert(auxData instanceof AuxData);
        assert(typeof rollType === "string");
        assert(player instanceof Player);

        this._auxData = auxData;
        this._rollType = rollType;
        this._player = player;
    }

    /**
     * Create a localized, human-readable report of active unit modifiers.
     *
     * @returns {string}
     */
    getModifiersReport(combatOnly) {
        let unitModifiers = this._auxData.unitModifiers;

        if (combatOnly) {
            unitModifiers = unitModifiers.filter((unitModifier) => {
                return unitModifier.raw.isCombat;
            });
        }

        let modifierList;
        if (unitModifiers.length > 0) {
            modifierList = unitModifiers
                .map((unitModifier) => {
                    const name = locale(unitModifier.raw.localeName);
                    const desc = locale(unitModifier.raw.localeDescription);
                    return `${name} (${desc})`;
                })
                .join(", ");
        } else {
            modifierList = locale("ui.message.none");
        }

        return locale("ui.message.roll_modifiers", {
            modifierCount: unitModifiers.length,
            modifierList,
        });
    }

    getRollReport(unitToDice) {
        // Generate one message per unit type with to-hit required and roll values.
        const unitMessages = [];
        for (const [unit, dice] of Object.entries(unitToDice)) {
            const unitAttrs = this._auxData.unitAttrsSet.get(unit);
            const rollAttrs = unitAttrs.raw[this._rollType];
            const unitMessage = [
                locale(unitAttrs.raw.localeName),
                " [",
                locale("ui.message.roll.hit"),
                ":",
                rollAttrs.hit,
            ];
            if (rollAttrs.dice && rollAttrs.dice > 1) {
                unitMessage.push("(x");
                unitMessage.push(rollAttrs.dice);
                unitMessage.push(")");
            }
            if (rollAttrs.extraHitsOn) {
                unitMessage.push(", ");
                unitMessage.push(locale("ui.message.roll.crit"));
                unitMessage.push("(x");
                unitMessage.push((rollAttrs.extraHitsOn.count || 1) + 1);
                unitMessage.push("):");
                unitMessage.push(rollAttrs.extraHitsOn.value);
            }
            unitMessage.push("]: ");
            const diceMessages = dice.map((die) => {
                return die.getValueStr();
            });
            unitMessage.push(diceMessages.join(", "));
            unitMessages.push(unitMessage.join(""));
        }
        const perUnitReport =
            unitMessages.length > 0
                ? unitMessages.join(", ")
                : locale("ui.message.no_units");

        // Generate total-hits message.
        let totalHits = 0;
        for (const dice of Object.values(unitToDice)) {
            for (const die of dice) {
                totalHits += die.countHits();
            }
        }
        const landed = locale("ui.message.player_landed_hits", {
            playerName: this._player.getName(),
            hits: totalHits,
        });

        return (
            locale("ui.message.player_rolled", {
                playerName: this._player.getName(),
                report: perUnitReport,
            }) +
            "\n" +
            landed
        );
    }

    /**
     * Compute how many dice to roll for each unit type.
     *
     * @returns {Object.{string:number}} unit to dice count
     */
    getUnitToDiceCount() {
        const unitToDiceCount = {};

        for (const unitAttrs of this._auxData.unitAttrsSet.values()) {
            const unit = unitAttrs.raw.unit;
            const rollAttrs = unitAttrs.raw[this._rollType];
            if (!rollAttrs) {
                continue; // unit does not have this roll type
            }

            let count = 0;

            // Count in-hex units.
            if (this._auxData.has(unit)) {
                const unitCount = this._auxData.count(unit);
                const dicePerUnit = rollAttrs.dice || 1;
                count += unitCount * dicePerUnit;
            }

            // Count adjacent units IF THEY HAVE RANGE.
            const ranged = rollAttrs.range && rollAttrs.range > 0;
            if (ranged && this._auxData.hasAdjacent(unit)) {
                const unitCount = this._auxData.adjacentCount(unit);
                const dicePerUnit = rollAttrs.dice || 1;
                count += unitCount * dicePerUnit;
            }

            // Apply any extra dice IF ROLLING AT LEAST ONE.
            if (count > 0) {
                const extraDice = rollAttrs.extraDice || 0;
                unitToDiceCount[unit] = count + extraDice;
            }
        }

        return unitToDiceCount;
    }

    /**
     * Create (but do not roll) dice.
     *
     * @param {Vector} dicePos - spawn dice "around" this position
     * @returns {Object.{string:Array.{UnitDie}}} unit to dice count
     */
    spawnDice(dicePos) {
        assert(typeof dicePos.x === "number");

        const unitToDiceCount = this.getUnitToDiceCount();
        const unitToDice = {};
        for (const [unit, diceCount] of Object.entries(unitToDiceCount)) {
            const unitAttrs = this._auxData.unitAttrsSet.get(unit);
            const spawnPos = dicePos; // XXX TODO
            const unitDieBuilder = new UnitDieBuilder(
                unitAttrs,
                this._rollType
            ).setDeleteAfterSeconds(30);
            unitToDice[unit] = [];
            for (let i = 0; i < diceCount; i++) {
                unitToDice[unit].push(
                    unitDieBuilder
                        .setSpawnPosition(spawnPos)
                        .build(this._player)
                );
            }
        }
        return unitToDice;
    }

    /**
     * Roll dice and report results.
     * Report special behaviors like crits.
     *
     * Assumes unit modifiers have already been applied to AuxData.
     *
     * @param {Vector} dicePos - spawn dice "around" this position
     * @returns {Array.{UnitDie}}
     */
    roll(dicePos) {
        assert(typeof dicePos.x === "number");

        const unitToDice = this.spawnDice(dicePos);
        const dice = [];
        for (const unitDice of Object.values(unitToDice)) {
            dice.push(...unitDice);
        }

        Broadcast.broadcastAll(
            locale("ui.message.player_rolling_for", {
                playerName: this._player.getName(),
                rollType: this._rollType, // XXX TODO
            })
        );
        const report = this.getModifiersReport(true);
        Broadcast.chatAll(report);

        if (dice.length === 0) {
            Broadcast.broadcastAll(locale("ui.message.no_units"));
        } else {
            RollGroup.roll(dice, () => {
                const report = this.getRollReport(unitToDice);
                Broadcast.broadcastAll(report);
            });
        }

        return dice;
    }
}

module.exports = { CombatRoller };
