const express = require('express');
const path = require('path');
const partials = require('express-partials');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const passport = require('passport');
const flash = require('connect-flash');
const toastr = require('express-toastr');

const { Issuer, Strategy } = require('openid-client');

const config = require('./config.json');

const helpers = require('./helpers');

const viewsRouter = require('./routes/views');
const proposalRouter = require('./routes/proposal');
const userRouter = require('./routes/user');
const adminRouter = require('./routes/admin');
const questionRouter = require('./routes/question');

const loginController = require('./controllers/loginController');

const { globalErrorHandler } = require('./errors');

const app = express();

databaseConfig = config.database

mongodbURI = process.env.MONGODB_URI || `mongodb://${databaseConfig.user}:${databaseConfig.password}@${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.dbName}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// view engine setup
app.set('views', path.join(__dirname, 'templates'));
app.set('view engine', 'ejs');

// Produce logs via morgan's middleware.
app.use(morgan('common'));

// Middleware for reading form-encoded POST payloads.
app.use(express.json());

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Serve the frontend files.
app.use(express.static(path.join(__dirname, 'templates/static')));
app.use(partials());

// Let Express know if we are using a reverse proxy.
if (config.server.usingProxy) app.set('trust proxy', 1);

console.info("Conectando a MongoDB mediante: ", mongodbURI);

mongoose.connect(mongodbURI);
mongoose.Promise = global.Promise;
const db = mongoose.connection

app.use(session({
	secret: config.server.sessionSecret,
	resave: false,
	proxy: config.server.usingProxy,
	saveUninitialized: true,
	store: new MongoStore({ mongoUrl: mongodbURI }),
	cookie: {
		// Make the cookies HTTPS-only if this is a production deployment.
		secure: process.env.NODE_ENV === 'production',
		// The cookie shouldn't be valid after 20 minutes of inactivity.
		maxAge: 20 * 60 * 1000, // milliseconds
	},
	sameSite: 'strict',
}));

// Use helmet headers to secure our application.
app.use(helmet());
// Use passport middlewares for authentication.
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
	//console.log('-----------------------------');
	//console.log('Serialize user');
	//console.log(user);
	//console.log('-----------------------------');
	done(null, user);
});
passport.deserializeUser((user, done) => {
	//console.log('-----------------------------');
	//console.log('Deserialize user');
	//console.log(user);
	//console.log('-----------------------------');
	done(null, user);
});

Issuer.discover(config.sso.wellKnownEndpoint)
	.then((keycloakIssuer) => {
		const keycloak = new keycloakIssuer.Client({
			client_id: config.sso.client,
			client_secret: config.sso.secret,
			redirect_uris: config.sso.redirectUris,
			response_types: ['code'],
		});

		passport.use(
			'oidc',
			new Strategy({ client: keycloak, passReqToCallback: true }, (req, tokenSet, userinfo, done) => {
				//console.log('tokenSet', tokenSet);
				//console.log('userinfo', userinfo);
				req.session.tokenSet = tokenSet;
				req.session.userinfo = userinfo;
				return done(null, tokenSet.claims());
			}),
		);
	});

app.use(flash());
app.use(toastr());

app.use(function (req, res, next)
{
    res.locals.toasts = req.toastr.render()
    next()
});

// Middleware to send to res.locals the categories from helpers.retrieveCategories
app.use(async (req, res, next) => {
	const categories = await helpers.retrieveCategories();
	res.locals.categories = categories;
	next();
});

// Middleware to send to res.locals the centres from helpers.retrieveCentres
app.use(async (req, res, next) => {
	const centres = await helpers.retrieveCentres();
	res.locals.centres = centres;
	next();
});

// Middleware to send to res.locals the affiliations from helpers.retrieveAffiliations
app.use(async (req, res, next) => {
	const affiliations = await helpers.retrieveAffiliations();
	res.locals.affiliations = affiliations;
	next();
});

// Middleware to send to res.locals the candidates from helpers.retrieveCandidates
app.use(async (req, res, next) => {
	const candidates = await helpers.retrieveCandidates();
	res.locals.candidates = candidates;
	next();
});

// Login routes.
app.get('/login', passport.authenticate('oidc', { scope: config.sso.scope }));

app.get('/login/callback', (req, res, next) => passport.authenticate('oidc', (err, user) => {
	if (err) { console.log(err); return res.status(500); }
	if (user) { req.session.userInfo = user; return next(); }
	console.log(err); return res.status(500);
})(req, res, next), loginController.handleLogin, (req, res) => {
	const redirectTo = req.session.referer;
	req.session.referer = null;
	return res.redirect(redirectTo || '/');
});

app.use(function (req, res, next) {
	res.locals.user = req.session.user;
	res.setHeader(
		'Content-Security-Policy',
		`default-src 'self' *.upm.es; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://code.jquery.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' 'unsafe-inline' data: https://da.upm.es;`
	);
	next();
});

app.use('/', viewsRouter);
app.use('/api/proposals', proposalRouter);
//app.use('/api/users', userRouter);
app.use('/api/admin', adminRouter);
app.use('/api/questions', questionRouter);

app.use('*', (req, res, next) => {res.status(404).render('notFound')});

// The error handler that produces 404/500 HTTP responses.
app.use(globalErrorHandler);

const port = process.env.NODE_PORT || config.server.port || 3000;

app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});

