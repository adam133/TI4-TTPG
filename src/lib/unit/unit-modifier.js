const assert = require("../../wrapper/assert-wrapper");
const locale = require("../locale");
const { CardUtil } = require("../card/card-util");
const { ObjectNamespace } = require("../object-namespace");
const { world } = require("../../wrapper/api");
const UNIT_MODIFIERS = require("./unit-modifier.data");

const PRIORITY = {
    "mutate.early": 9,
    mutate: 10,
    "mutate.late": 11,
    "adjust.early": 19,
    adjust: 20,
    "adjust.late": 21,
    "choose.early": 29,
    choose: 30,
    "choose.late": 30,
};

const OWNER = {
    self: true,
    opponent: true,
    any: true,
};

let _triggerNsidToUnitModifier = false;
let _factionAbilityToUnitModifier = false;
let _unitAbilityToUnitModifier = false;
let _triggerIfUnitModifiers = false;

function _maybeInit() {
    if (_triggerNsidToUnitModifier) {
        return; // already initialized
    }
    _triggerNsidToUnitModifier = {};
    _factionAbilityToUnitModifier = {};
    _unitAbilityToUnitModifier = {};
    _triggerIfUnitModifiers = [];

    for (const rawModifier of UNIT_MODIFIERS) {
        const unitModifier = new UnitModifier(rawModifier);

        if (rawModifier.triggerNsid) {
            _triggerNsidToUnitModifier[rawModifier.triggerNsid] = unitModifier;
        }
        if (rawModifier.triggerNsids) {
            for (const triggerNsid of rawModifier.triggerNsids) {
                assert(!_triggerNsidToUnitModifier[triggerNsid]);
                _triggerNsidToUnitModifier[triggerNsid] = unitModifier;
            }
        }

        if (rawModifier.triggerFactionAbility) {
            const ability = rawModifier.triggerFactionAbility;
            assert(!_factionAbilityToUnitModifier[ability]);
            _factionAbilityToUnitModifier[ability] = unitModifier;
        }

        if (rawModifier.triggerUnitAbility) {
            const ability = rawModifier.triggerUnitAbility;
            assert(!_unitAbilityToUnitModifier[ability]);
            _unitAbilityToUnitModifier[ability] = unitModifier;
        }

        if (rawModifier.triggerIf) {
            _triggerIfUnitModifiers.push(unitModifier);
        }
    }
}

/**
 * A unit modifier mutates one or more unit attributes.
 *
 * Modifiers may have `applyEach(UnitData)` and `applyAll(UnitTypeToUnitData)`.
 * `applyEach` is for simple modifiers, called separately for each unit type.
 * `applyAll` is for modifiers that need to see all units at once, for instance
 * to choose the "best" to receive a bonus.
 */
class UnitModifier {
    /**
     * Sort in apply order.
     *
     * @param {Array.<unitModifier>} unitModifierArray
     * @returns {Array.<unitModifier>} ordered (original list also mutated in place)
     */
    static sortPriorityOrder(unitModifierArray) {
        unitModifierArray.sort((a, b) => {
            return (
                PRIORITY[a._modifier.priority] - PRIORITY[b._modifier.priority]
            );
        });
        return unitModifierArray;
    }

    /**
     * Find player's unit modifiers, EXCLUDES FACTION MODIFIERS!
     *
     * @param {number} playerSlot
     * @param {string} withOwner - self, opponent, any
     * @returns {Array.<unitModifier>} modifiers
     */
    static getPlayerUnitModifiers(playerSlot, withOwner) {
        assert(typeof playerSlot === "number");
        assert(typeof withOwner === "string");
        assert(OWNER[withOwner]);

        _maybeInit();
        const unitModifiers = [];
        for (const obj of world.getAllObjects()) {
            const objNsid = ObjectNamespace.getNsid(obj);
            const unitModifier = _triggerNsidToUnitModifier[objNsid];
            if (!unitModifier) {
                continue;
            }

            if (!CardUtil.isLooseCard(obj)) {
                continue; // not a lone, faceup card on the table
            }

            // Enfoce modifier type (self, opponent, any).
            if (unitModifier.raw !== "any") {
                // Not an "any", require it be of "withType".
                if (unitModifier.raw.owner !== withOwner) {
                    continue;
                }

                // Matches "withType", require it belong to player.
                let ownerSlot = obj.getOwningPlayerSlot();
                if (ownerSlot < 0) {
                    const pos = obj.getPosition();
                    const playerDesk = world.TI4.getClosestPlayerDesk(pos);
                    ownerSlot = playerDesk.playerSlot;
                }
                if (ownerSlot !== playerSlot) {
                    continue; // different owner
                }
            }

            // Found a unit modifier!  Add it to the list.
            unitModifiers.push(unitModifier);
        }

        return unitModifiers;
    }

    /**
     * Get faction-intrinsic unit modifiers based on faction abilities.
     *
     * @param {Faction} faction
     * @param {string} withOwner - self, opponent, any
     * @returns {Array.<unitModifier>} modifiers
     */
    static getFactionUnitModifiers(faction, withOwner) {
        assert(typeof withOwner === "string");
        assert(OWNER[withOwner]);

        const unitModifiers = [];
        for (const factionAbility of faction.raw.abilities) {
            const unitModifier = _factionAbilityToUnitModifier[factionAbility];
            if (unitModifier) {
                // Enfoce modifier type (self, opponent, any).
                if (unitModifier.raw !== "any") {
                    // Not an "any", require it be of "withType".
                    if (unitModifier.raw.owner !== withOwner) {
                        continue;
                    }

                    unitModifiers.push(unitModifier);
                }
            }
        }
        return unitModifiers;
    }

    /**
     * In addition to "found an object" modifiers, let generic modifiers
     * inspect state to see if they apply.
     *
     * @param {AuxData} auxData
     * @returns {Array.{UnitModifier}}
     */
    static getTriggerIfUnitModifiers(auxData) {
        const unitModifiers = [];
        for (const unitModifier of _triggerIfUnitModifiers) {
            if (unitModifier.raw.triggerIf(auxData)) {
                unitModifiers.push(unitModifier);
            }
        }
        return unitModifiers;
    }

    /**
     * Get unit modifier associated with nsid.
     *
     * @param {string} nsid
     * @returns {unitModifier}
     */
    static getNsidUnitModifier(nsid) {
        assert(typeof nsid === "string");
        _maybeInit();
        return _triggerNsidToUnitModifier[nsid];
    }

    /**
     * Get faction ability.
     *
     * @param {string} factionAbility
     * @returns {unitModifier}
     */
    static getFactionAbilityUnitModifier(factionAbility) {
        assert(typeof factionAbility === "string");
        _maybeInit();
        return _factionAbilityToUnitModifier[factionAbility];
    }

    /**
     * Get faction abililities.
     *
     * @param {string} unitAbility
     * @returns {unitModifier}
     */
    static getUnitAbilityUnitModifier(unitAbility) {
        assert(typeof unitAbility === "string");
        _maybeInit();
        return _unitAbilityToUnitModifier[unitAbility];
    }

    // ------------------------------------------------------------------------

    /**
     * Constructor.
     *
     * @param {object} modifier - UnitModifiersSchema compliant object
     */
    constructor(modifier) {
        assert(typeof modifier === "object");
        this._modifier = modifier;
    }

    /**
     * Localized modifier name.
     *
     * @returns {string}
     */
    get name() {
        return locale(this._modifier.localeName);
    }

    /**
     * Localized modifier description.
     *
     * @returns {string}
     */
    get desc() {
        return locale(this._modifier.localeDescription);
    }

    /**
     * Get the underlying object.
     *
     * @returns {object}
     */
    get raw() {
        return this._modifier;
    }

    /**
     * Apply unit modifier.
     *
     * @param {object} unitToUnitAttrs - mutated in place
     * @param {object} auxData - table of misc things modifiers might use
     */
    apply(unitAttrsSet, auxData) {
        if (this._modifier.applyEach) {
            for (const unitAttrs of unitAttrsSet.values()) {
                this._modifier.applyEach(unitAttrs, auxData);
            }
        }
        if (this._modifier.applyAll) {
            this._modifier.applyAll(unitAttrsSet, auxData);
        }
    }
}

module.exports = {
    UnitModifier,
    PRIORITY,
    OWNER,
};
