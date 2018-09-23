/**
 * @todo this needs audit logging of changes being made
 */

var fl = require('flux-link');
var db = require('db-filters');
var _ = require('underscore');
var dust = require('dustjs-linkedin');
require('dustjs-helpers');

var privs = require('../lib/privs.js');
var audit = require('../lib/audit.js');
var users = require('../lib/users.js');
var seasons = require('../lib/seasons.js');
var teams = require('../lib/teams.js');
var matches = require('../lib/matches.js');

/**
 * Helper used to check if someone has the ability to create seasons or not
 * @return true if they can modify seasons, false otherwise
 */
function checkSeasonPrivs(env, after) {
	after(privs.hasPriv(env.user.privs, privs.MODIFY_SEASON));
}

/**
 * Preamble for all seasons, this sets up the season info that is needed on each page
 */
var season_preamble = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.seasonid, 10);
		if (isNaN(id)) {
			env.$throw(new Error('Season not found'));
			return;
		}

		env.seasonId = id;
		after(id);
	},
	seasons.getSeasonBasic,
	function(env, after, season) {
		env.season = season;
		env.$output({season : season});
		after();
	}
);

/**
 * Handler to rename a season
 */
var edit_season = new fl.Branch(
	checkSeasonPrivs,
	new fl.Chain(
		function(env, after) {
			var id = parseInt(env.req.params.seasonid);
			if (isNaN(id)) {
				env.$throw(new Error('Invalid season ID specified'));
				return;
			}

			var seasonStatus = parseInt(env.req.body.status);
			var seasonType = parseInt(env.req.body.type);
			var seasonLinear = parseInt(env.req.body.linearization);
			var seasonTicket = parseInt(env.req.body.ticket);
			if (!env.req.body.name || !seasons.isValidStatus(seasonStatus)
				|| !seasons.isValidType(seasonType)
				|| !seasons.isValidLinearization(seasonLinear)) {
				env.$throw(new Error('Bad season update parameters given'));
				return;
			}

			env.filters.seasons.update({
				name : env.req.body.name,
				status : seasonStatus,
				type : seasonType,
				ticket : seasonTicket,
				linearization : seasonLinear,
			}, {id : id}).exec(after, env.$throw);
		},
		function(env, after) {
			env.$redirect('/seasons/'+env.req.params.seasonid);
			after();
		}
	),
	function(env, after) {
		env.$throw(new Error('You do not have permission to change season settings'));
	}
);

/**
 * Handler for the season listing route
 */
var season_index = new fl.Chain(
	checkSeasonPrivs,
	function(env, after, canCreateSeason) {
		env.$output({canCreateSeason : canCreateSeason});
		env.filters.seasons.select({}).exec(after, env.$throw);
	},
	function(env, after, seasons) {
		env.$output({seasons : seasons});
		env.$template('season_list');
		after();
	}
);

/**
 * Generate the main season hub page, which is just the details for a single season
 */
var season_hub = new fl.Chain(
	season_preamble,
	function(env, after) {
		env.$template('season_hub');
		after();
	}
).use_local_env(true);

/**
 * Show the list of signups for the season, with filtering for ineligible/banned
 * players and standins (standins have their own page)
 */
var signups = new fl.Chain(
	season_preamble,
	function(env, after) {
		after(env.season, {valid_standin : 0, standin : 0});
	},
	seasons.getSignups,
	function(env, after, signups) {
		var isAdmin = privs.hasPriv(env.user.privs, privs.MODIFY_SEASON);
		var canSignUp = (seasons.STATUS_SIGNUPS == env.season.status);
		var signedUp = _.reduce(signups, function(memo, v, k) {
			return memo || (v.steamid == env.user.steamid);
		}, false);

		var scripts = ['sort', 'season'];

		env.$template('season_signups');
		env.$output({
			title : 'Signups',
			isAdmin : isAdmin,
			canSignUp : canSignUp && !signedUp,
			signedUp : signedUp,
			signups : signups,
			scripts : scripts
		});
		after();
	}
).use_local_env(true);

/**
 * Show the list of dedicated standins, which covers people who requested to be such
 * and people we moved to the standin list
 */
var standins = new fl.Chain(
	season_preamble,
	function(env, after) {
		after(env.season, {valid_standin : 1});
	},
	seasons.getSignups,
	function(env, after, signups) {
		env.signups = signups;
		after(env.season, {standin : 1});
	},
	seasons.getSignups,
	function(env, after, signups) {
		var isAdmin = privs.hasPriv(env.user.privs, privs.MODIFY_SEASON);

		signups = _.uniq(env.signups.concat(signups), function(v) {
			return v.steamid;
		});

		env.$template('season_signups');
		env.$output({
			title : 'Standins',
			isAdmin : isAdmin,
			standins : true,
			signups : signups,
			scripts : ['sort', 'season']
		});
		after();
	}
).use_local_env(true);

/**
 * Show the list of draftable players as well as teams for draft interface
 */
var draft = new fl.Chain(
	season_preamble,
	function(env, after) {
		after(env.season, {draftable : 1, standin : 0, valid_standin : 0});
	},
	seasons.getSignups,
	function(env, after, signups) {
		signups = _.sortBy(signups, function(v) {
			return -v.medal;
		});
		env.$output({signups : signups});
		after(env.season.id);
	},
	teams.getAllTeams,
	function(env, after, teams) {
		var isAdmin = privs.hasPriv(env.user.privs, privs.MODIFY_SEASON);

		env.$template('season_draft');
		env.$output({
			title : 'Draft',
			isAdmin : isAdmin,
			scripts : ['sort', 'draft'],
			teams : teams
		});
		after();
	}
).use_local_env(true);

/**
 * Show season details which is a list of players that signed up
 */
var season_info = new fl.Chain(
	// Show signup list
	function(env, after) {
		var id = parseInt(env.req.params.seasonid, 10);
		if (isNaN(id)) {
			env.$throw(new Error('Season not found'));
			return;
		}

		env.seasonId = id;
		after(id);
	},
	seasons.getSeason,
	function (env, after, season) {
		var canEdit = privs.hasPriv(env.user.privs, privs.MODIFY_SEASON);
		var canSignUp = true;
		var signedUp = _.reduce(season.signups, function(memo, v, k) {
			return memo || (v.steamid == env.user.steamid);
		}, false);
		var statusLabels = [
			{value : seasons.STATUS_HIDDEN, label : "Hidden"},
			{value : seasons.STATUS_SIGNUPS, label : "Signups"},
			{value : seasons.STATUS_PLAYING, label : "Playing"},
			{value : seasons.STATUS_DRAFTING, label : "Drafting"},
			{value : seasons.STATUS_FINISHED, label : "Finished"}
		];
		var typeLabels = [
			{value : seasons.TYPE_DRAFT, label : "EU/RD2L Draft"},
			{value : seasons.TYPE_IHL, label : "Inhouse League"},
		];
		var linearLabels = [
			{value : seasons.LINEARIZATION_2018S1, label : "2018 Season 1"},
			{value : seasons.LINEARIZATION_2018S2, label : "2018 Season 2"},
		];
		var isDrafting = (season.status == seasons.STATUS_DRAFTING);
		var scripts = ['sort'];

		statusLabels.forEach(function(v, k) {
			v.selected = '0';
			if (v.value == season.status)
				v.selected = '1';
		});

		typeLabels.forEach(function(v, k) {
			v.selected = '0';
			if (v.value == season.type)
				v.selected = '1';
		});

		linearLabels.forEach(function(v, k) {
			v.selected = '0';
			if (v.value == season.linearization)
				v.selected = '1';
		});

		if (isDrafting || canEdit) {
			scripts.push('draft');
		}

		env.season = season;
		env.$template('season_info');
		env.$output({
			canSignUp : canSignUp && !signedUp && !isDrafting,
			signedUp : signedUp && !isDrafting,
			canEditSeason : canEdit,
			isDrafting : isDrafting,
			showTeams : false,
			statuses : statusLabels,
			types : typeLabels,
			linearizations : linearLabels,
			season : season,
			scripts : scripts
		});
		after();
	},
	new fl.Branch(
		function(env, after) {
			after(env.season.status == seasons.STATUS_DRAFTING);
		},
		new fl.Chain(
			function(env, after) {
				after(env.season.id);
			},
			teams.getAllTeams,
			function(env, after, teams) {
				env.$output({teams : teams});
				after();
			}
		),
		function(env, after) {
			after();
		}
	)
).use_local_env(true);

/**
 * Create a season
 */
var season_create = new fl.Branch(
	checkSeasonPrivs,
	new fl.Chain(
		function(env, after) {
			env.filters.seasons.insert({
				name : 'New Season',
				status : 0
			}).exec(after, env.$throw);
		},
		function(env, after) {
			env.$redirect('/seasons');
			after();
		}
	),
	function(env, after) {
		env.$throw(new Error('You don\'t have privs to create a new season'));
	}
);

/**
 * Show signup form, if a person is allowed to sign up
 */
var show_signup_form = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.seasonid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		// Find the correct steamid of the signup to edit
		var steamid = env.req.params.steamid;
		env.steamid = steamid;
		env.mySignup = true;
		if (undefined !== steamid && steamid != env.user.steamid) {
			env.mySignup = false;
			if (!privs.hasPriv(env.user.privs, privs.MODIFY_ACCOUNT)) {
				env.$throw(new Error('You do not have the ability to change signups'));
				return;
			}
		}
		else {
			env.steamid = env.user.steamid;
		}

		after(id);
	},
	seasons.getSeasonBasic,
	function(env, after, seasonInfo) {
		if (seasons.STATUS_SIGNUPS != seasonInfo.status) {
			env.$throw(new Error('This season is not currently accepting signups'));
			return;
		}

		env.$output({
			season : seasonInfo,
			steamid : env.steamid
		});

		env.filters.signups.select({
			steamid : env.steamid,
			season : seasonInfo.id
		})
			.left_join(env.filters.users, 'u')
			.on(['steamid', 'steamid'])
			.fields(1, 'display_name')
			.exec(after, env.$throw);
	},
	function(env, after, signup) {
		if (signup.length > 0) {
			// dust uses === comparison and requires strings, so convert numbers we have
			env.$output({
				display_name : signup[0].display_name,
				statement : signup[0].statement,
				captain : signup[0].captain+'',
				standin : signup[0].standin+'',
				medal : signup[0].medal,
				editSignup : true,
				fixedMedal : env.mySignup
			});
		}
		else {
			env.$output({
				display_name : env.user.display_name
			});
		}

		env.$template('season_signup');
		after();
	},
	new fl.Branch(
		function(env, after) {
			after(env.mySignup);
		},
		new fl.Chain(
			function(env, after) {
				after(env.user.id32);
			},
			users.getMedal,
			function(env, after, medal) {
				env.$output({medal : medal});
				after();
			}
		),
		function(env, after) {
			after();
		}
	)
).use_local_env(true);

/**
 * Handle a signup form and send them back if it was incomplete
 */
var handle_signup_form = new fl.Chain(
	function(env, after) {
		var id = parseInt(env.req.params.seasonid);
		if (isNaN(id)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		var steamid = env.req.params.steamid;
		env.steamid = steamid;
		env.mySignup = true;
		if (undefined !== steamid && steamid != env.user.steamid) {
			env.mySignup = false;
			if (!privs.hasPriv(env.user.privs, privs.MODIFY_ACCOUNT)) {
				env.$throw(new Error('You do not have the ability to change signups'));
				return;
			}
		}
		else {
			env.steamid = env.user.steamid;
		}

		after(id);
	},
	seasons.getSeasonBasic,
	function(env, after, seasonInfo) {
		if (seasons.STATUS_SIGNUPS !== seasonInfo.status) {
			env.$throw(new Error('This season is not currently accepting signups'));
			return;
		}

		env.season = seasonInfo;
		after();
	},
	new fl.Branch(
		function(env, after) {
			after(env.mySignup);
		},
		new fl.Chain(
			function(env, after) {
				after(env.user.id32);
			},
			users.getMedal,
			function(env, after, medal) {
				env.medal = medal;
				after();
			}
		),
		function(env, after) {
			env.medal = parseInt(env.req.body.medal);
			after();
		}
	),
	function(env, after) {
		env.filters.signups.select({
			steamid : env.steamid,
			season : env.season.id
		}).exec(after, env.$throw);
	},
	function(env, after, signup) {
		if (signup.length > 0) {
			env.filters.signups.update({
				medal : env.medal,
				statement : env.req.body.statement,
				captain : parseInt(env.req.body.captain),
				standin : parseInt(env.req.body.standin)
			}, {
				steamid : env.steamid,
				season : env.season.id
			}).exec(after, env.$throw);
		}
		else {
			env.filters.signups.insert({
				time : db.$now(),
				steamid : env.steamid,
				season : env.season.id,
				medal : env.medal,
				statement : env.req.body.statement,
				captain : parseInt(env.req.body.captain),
				standin : parseInt(env.req.body.standin)
			}).exec(after, env.$throw);
		}
	},
	function(env, after) {
		// Trim statement to match db field size
		after(env.user, audit.EVENT_EDIT, {
			steamid : env.steamid
		}, {
			time : new Date(),
			season : env.season.id,
			medal : env.medal,
			statement : env.req.body.statement.substring(0, 255),
			captain : parseInt(env.req.body.captain),
			standin : parseInt(env.req.body.standin)
		});
	},
	audit.logUserEvent,
	function(env, after) {
		env.$redirect('/seasons/'+env.season.id+'/signups');
		after();
	}
);

/**
 * Ajax callback to create a new team with the given captain
 */
var create_team = new fl.Chain(
	function(env, after) {
		env.seasonId = parseInt(env.req.body.season);
		if (isNaN(env.seasonId)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		env.steamid = env.req.body.steamid;
		after(env.seasonId);
	},
	seasons.getSeason,
	function(env, after, season) {
		env.season = season;
		env.foundPlayer = season.signups.reduce(function(memo, v) {
			return memo || (v.steamid == env.steamid);
		}, false);

		if (!env.foundPlayer) {
			env.$throw(new Error('Nobody with this steam ID signed up'));
			return;
		}

		after(env.steamid);
	},
	users.getUser,
	function(env, after, captain) {
		after(env.user, captain, env.season.id);
	},
	teams.create,
	function(env, after, team) {
		env.$json({
			name : team.name,
			id : team.id,
		});
		after();
	}
).use_local_env(true);

/**
 * Get and display the leaderboard for an inhouse season
 */
var show_leaderboard = new fl.Chain(
	function(env, after) {
		env.seasonId = parseInt(env.req.params.seasonid);
		if (isNaN(env.seasonId)) {
			env.$throw(new Error('Invalid season ID specified'));
			return;
		}

		after(env.seasonId);
	},
	seasons.getSeason,
	function(env, after, season) {
		if (seasons.TYPE_IHL != season.type) {
			env.$throw(new Error('This season is not an inhouse league and has no leaderboard!'));
			return;
		}

		env.season = season;
		after(season);
	},
	matches.getLeaderboards,
	function(env, after, leaderboard) {
		env.$template('leaderboard');
		env.$output({
			season : env.season,
			leaderboard : leaderboard
		});
		after();
	}
).use_local_env(true);

/**
 * Chain used to get season information for display in the sidebar
 */
var sidebar_seasons = new fl.Chain(
	function(env, after) {
		env.filters.seasons.select({
			status : [
				seasons.STATUS_SIGNUPS,
				seasons.STATUS_PLAYING,
				seasons.STATUS_DRAFTING
			]
		}).exec(after, env.$throw);
	},
	function(env, after, seasons) {
		env.$output({
			'sidebar_seasons' : seasons
		});
		after();
	}
);

module.exports.init_routes = function(server) {
	server.add_pre_hook(sidebar_seasons, 'default');

	server.add_route('/seasons', {
		fn : season_index,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/:seasonid', {
		fn : season_hub,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/:seasonid/signups', {
		fn : signups,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/:seasonid/standins', {
		fn : standins,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/:seasonid/draft', {
		fn : draft,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/signup/:seasonid', {
		fn : show_signup_form,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/signup/:seasonid', {
		fn : handle_signup_form,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'post');

	server.add_route('/seasons/signup/:seasonid/:steamid', {
		fn : show_signup_form,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/signup/:seasonid/:steamid', {
		fn : handle_signup_form,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'post');

	server.add_route('/seasons/admin/create', {
		fn : season_create,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'get');

	server.add_route('/seasons/:seasonid/edit', {
		fn : edit_season,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'post');

	server.add_route('/seasons/new_team', {
		fn : create_team,
		pre : ['default', 'require_user'],
		post : ['default']
	}, 'post');

	server.add_route('/seasons/:seasonid/leaderboard', {
		fn : show_leaderboard,
		pre : ['default', 'optional_user'],
		post : ['default']
	}, 'get');

	server.add_dust_helpers({
		season_status : function(chunk, context, bodies, params) {
			var status = parseInt(dust.helpers.tap(params.status, chunk, context));

			if (seasons.STATUS_HIDDEN == status)
				chunk.write('Hidden');
			else if (seasons.STATUS_SIGNUPS == status)
				chunk.write('Accepting signups');
			else if (seasons.STATUS_PLAYING == status)
				chunk.write('Playing');
			else if (seasons.STATUS_FINISHED == status)
				chunk.write('Ended');
			else if (seasons.STATUS_DRAFTING == status)
				chunk.write('Drafting players');
			else
				chunk.write('Unrecognized status: '+status);

			return chunk;
		},
		season_type : function(chunk, context, bodies, params) {
			var type = parseInt(dust.helpers.tap(params.type, chunk, context));

			if (seasons.TYPE_DRAFT == type)
				chunk.write('EU/RD2L Draft');
			else if (seasons.TYPE_IHL == type)
				chunk.write('Inhouse League');
			else
				chunk.write('Unrecognized type: '+type);

			return chunk;
		},
		season_linearization : function(chunk, context, bodies, params) {
			var linear = parseInt(dust.helpers.tap(params.linear, chunk, context));

			if (seasons.LINEARIZATION_2018S1 == linear)
				chunk.write('2018 January-July');
			else if (seasons.LINEARIZATION_2018S2 == linear)
				chunk.write('2018 August-December');
			else
				chunk.write('Unrecognized linearization: '+linear);

			return chunk;
		}
	});
}
