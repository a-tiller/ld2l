/**
 * @todo this needs audit logging of changes being made
 */

var fl = require('flux-link');
var db = require('db-filters');
var _ = require('underscore');

var privs = require('../lib/privs.js');
var users = require('../lib/users.js');
var seasons = require('../lib/seasons.js');
var teams = require('../lib/teams.js');
var matches = require('../lib/matches.js');

/**
 * Remove all of the links between a player and a particular match
 * @todo: temporary here, make lib and stuff
 */
var remove_player = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.matchid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid match ID specified'));
			return;
		}

		var playerid = env.req.params.steamid;
		if (playerid.length != 17) {
			env.$throw(new Error('Invalid user ID specified'));
			return;
		}

		if (!privs.hasPriv(env.user.privs, privs.CREATE_LOBBY)) {
			env.$throw(new Error('You cannot edit match records.'));
			return;
		}

		env.matchid = id;
		env.filters.match_links.delete({
			matchid : id,
			steamid : playerid
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.$redirect('/matches/' + env.matchid);
		after();
	}
).use_local_env(true);

/**
 * Add a full record for a user. This has to be reworked in the future but it's used
 * for cheap data entry right now with minimal validation. Just delete and re-enter any
 * rows that are messed up
 * @todo: temporary, make lib, make robust (generate form dynamically possibly)
 */
var add_player = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.matchid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid match ID specified'));
			return;
		}

		if (!privs.hasPriv(env.user.privs, privs.CREATE_LOBBY)) {
			env.$throw(new Error('You cannot edit match records.'));
			return;
		}

		env.matchid = id;
		env.steamid = env.req.body.steamid;
		if (env.steamid.length != 17) {
			env.$throw(new Error('Remember to use the 17-digit steam64 ID for the player'));
			return;
		}

		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 1,
			value : parseInt(env.req.body.level)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 2,
			value : parseInt(env.req.body.hero)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 3,
			value : parseInt(env.req.body.kills)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 4,
			value : parseInt(env.req.body.deaths)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 5,
			value : parseInt(env.req.body.assists)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 6,
			value : parseInt(env.req.body.last_hits)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 7,
			value : parseInt(env.req.body.denies)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 8,
			value : parseInt(env.req.body.gpm)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 9,
			value : parseInt(env.req.body.xpm)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 10,
			value : parseInt(env.req.body.damage)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 11,
			value : parseInt(env.req.body.healing)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 12,
			value : parseInt(env.req.body.tower_damage)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 13,
			value : parseInt(env.req.body.team)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.filters.match_links.insert({
			matchid : env.matchid,
			steamid : env.steamid,
			property : 14,
			value : parseInt(env.req.body.net_worth)
		}).exec(after, env.$throw);
	},
	function(env, after) {
		env.items = env.req.body.items.split(',');
		env.idx = 0;
		after();
	},
	new fl.LoopChain(
		function(env, after) {
			after(env.idx < env.items.length);
		},
		function(env, after) {
			env.filters.match_links.insert({
				matchid : env.matchid,
				steamid : env.steamid,
				property : 100 + env.idx,
				value : parseInt(env.items[env.idx])
			}).exec(after, env.$throw);
		},
		function(env, after) {
			env.idx += 1;
			after();
		}
	),
	function(env, after) {
		env.$redirect('/matches/'+env.matchid);
		after();
	}
).use_local_env(true);

/**
 * Show detailed information for the single match specified
 * @param[in] env.req.params.matchid The integer database id of the match to look up
 */
var match_details = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.matchid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid match ID specified'));
			return;
		}

		env.matchId = id;
		after(id);
	},
	matches.getDetails,
	function(env, after, match) {
		env.$output({
			match : match,
			canEdit : privs.hasPriv(env.user.privs, privs.CREATE_LOBBY)
		});
		env.$template('match');
		after();
	}
).use_local_env(true);

/**
 * Show all matches from the given season
 * @param[in] season id
 * @todo create page for series that this can link to, which links to the individual matches
 */
var show_matches = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.seasonid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		env.seasonId = id;
		after(id);
	},
	seasons.getSeason,
	function(env, after, season) {
		env.season = season;
		after(env.seasonId);
	},
	matches.getAllSeries,
	function(env, after, series) {
		var week = _.reduce(series, function(memo, v) {
			return v[0].round > memo ? v[0].round : memo;
		}, 0);

		var current = [];
		var past = [];
		_.each(series, function(v, k) {
			if (week == k) {
				current = v;
			}
			else {
				past.push({
					matchups : v,
					week : v[0].round
				});
			}
		});

		past.sort(function(a, b) {
			return b.week - a.week;
		});

		env.$template('schedule');
		env.$output({
			season : env.season,
			week : week,
			matchups : current,
			past_matchups : past
		});
		after();
	}
);

/**
 * Show the matches for a given season in summary format
 */
var show_season_matches = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.seasonid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		env.seasonId = id;
		env.filters.matches.select({season : id})
			.order(db.$desc('id'))
			.exec(after, env.$throw);
	},
	matches.addSummaryInfo,
	function(env, after, matches) {
		env.matches = matches;
		after(env.seasonId);
	},
	seasons.getSeason,
	function(env, after, season) {
		env.$template('season_matches');
		env.$output({
			season : season,
			matches : env.matches
		});
		after();
	}
);

/**
 * Generate new matchups in swiss format
 */
var generate_matchups = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.seasonid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		if (!privs.hasPriv(env.user.privs, privs.MODIFY_SEASON)) {
			env.$throw(new Error('You do not have the ability to generate matchups'));
			return;
		}

		env.seasonId = id;
		after(id);
	},
	matches.generateMatchups,
	function(env, after) {
		env.$redirect('/schedule/'+env.seasonId);
		after();
	}
);

module.exports.init_routes = function(server) {
	server.add_route('/schedule/:seasonid', {
		fn : show_matches,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/schedule/:seasonid/next', {
		fn : generate_matchups,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'get');

	server.add_route('/matches/:matchid', {
		fn : match_details,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/:seasonid/matches', {
		fn : show_season_matches,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/matches/:matchid/remove_player/:steamid', {
		fn : remove_player,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'get');

	server.add_route('/matches/:matchid/add_player', {
		fn : add_player,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'post');
};
