import { createTheme, ThemeProvider, StyledEngineProvider, Theme, useMediaQuery } from "@mui/material";
import CssBaseline from "@mui/material/CssBaseline";
import { observer } from "mobx-react-lite";
import { SnackbarProvider } from "notistack";
import * as React from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { makeStyles } from "tss-react/mui";

import Applications from "../application/Applications";
import Clients from "../client/Clients";
import { ConnectionErrorBanner } from "../common/ConnectionErrorBanner";
import LoadingSpinner from "../common/LoadingSpinner";
import ScrollUpButton from "../common/ScrollUpButton";
import SettingsDialog from "../common/SettingsDialog";
import * as config from "../config";
import Messages from "../message/Messages";
import Plugins from "../plugin/Plugins";
import { useStores } from "../stores";
import Login from "../user/Login";
import Users from "../user/Users";
import Header from "./Header";
import Navigation from "./Navigation";
import { isThemeKey, ThemeKey } from "./theme";

const useStyles = makeStyles()((theme: Theme) => ({
	content: {
		margin: "0 auto",
		marginTop: 64,
		padding: theme.spacing(3),
		width: "100%",
		[theme.breakpoints.down("sm")]: {
			marginTop: 0,
			padding: theme.spacing(1),
		},
	},
}));

const localStorageThemeKey = "gotify-theme";

const Layout = observer(() => {
	const {
		currentUser: {
			loggedIn,
			authenticating,
			user: { name, admin },
			logout,
			tryReconnect,
			connectionErrorMessage,
			refreshKey,
		},
	} = useStores();
	const { classes } = useStyles();
	const [currentTheme, setCurrentTheme] = React.useState<ThemeKey>(() => {
		const stored = window.localStorage.getItem(localStorageThemeKey);
		return isThemeKey(stored) ? stored : "system";
	});
	const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
	const paletteMode = currentTheme === "system" ? (prefersDark ? "dark" : "light") : currentTheme;
	const theme = React.useMemo(
		() =>
			createTheme({
				palette: {
					mode: paletteMode,
				},
			}),
		[paletteMode],
	);
	const { version } = config.get("version");
	const [navOpen, setNavOpen] = React.useState(false);
	const [showSettings, setShowSettings] = React.useState(false);

	const toggleTheme = () => {
		const nextMap: Record<ThemeKey, ThemeKey> = {
			dark: "light",
			light: "system",
			system: "dark",
		};
		const next = nextMap[currentTheme];
		setCurrentTheme(next);
		localStorage.setItem(localStorageThemeKey, next);
	};

	const authed = (children: React.ReactNode) => (
		<RequireAuth loggedIn={loggedIn} authenticating={authenticating}>
			{children}
		</RequireAuth>
	);

	return (
		<StyledEngineProvider injectFirst>
			<ThemeProvider theme={theme}>
				<HashRouter>
					{/* This forces all components to fully rerender including useEffects.
                        The refreshKey is updated when store data was cleaned and pages should refetch their data. */}
					<div key={refreshKey}>
						{!connectionErrorMessage ? null : (
							<ConnectionErrorBanner height={64} retry={() => tryReconnect()} message={connectionErrorMessage} />
						)}
						<div style={{ display: "flex", flexDirection: "column" }}>
							<CssBaseline />
							<Header
								admin={admin}
								name={name}
								style={{ top: !connectionErrorMessage ? 0 : 64 }}
								version={version}
								loggedIn={loggedIn}
								themeMode={currentTheme}
								toggleTheme={toggleTheme}
								showSettings={() => setShowSettings(true)}
								logout={logout}
								setNavOpen={setNavOpen}
							/>
							<div style={{ display: "flex" }}>
								<Navigation loggedIn={loggedIn} navOpen={navOpen} setNavOpen={setNavOpen} />
								<main className={classes.content}>
									<Routes>
										<Route path="/login" element={<Login />} />
										<Route path="/" element={authed(<Messages />)} />
										<Route path="/messages/:id" element={authed(<Messages />)} />
										<Route path="/applications" element={authed(<Applications />)} />
										<Route path="/clients" element={authed(<Clients />)} />
										<Route path="/users" element={authed(<Users />)} />
										<Route path="/plugins" element={authed(<Plugins />)} />
										<Route
											path="/plugins/:id"
											element={authed(<Lazy component={() => import("../plugin/PluginDetailView")} />)}
										/>
									</Routes>
								</main>
							</div>
							{showSettings && <SettingsDialog fClose={() => setShowSettings(false)} />}
							<ScrollUpButton />
							<SnackbarProvider />
						</div>
					</div>
				</HashRouter>
			</ThemeProvider>
		</StyledEngineProvider>
	);
});

// eslint-disable-next-line
const Lazy = ({ component }: { component: () => Promise<{ default: React.ComponentType<any> }> }) => {
	const Component = React.lazy(component);

	return (
		<React.Suspense fallback={<LoadingSpinner />}>
			<Component />
		</React.Suspense>
	);
};

const RequireAuth: React.FC<React.PropsWithChildren<{ loggedIn: boolean; authenticating: boolean }>> = ({
	children,
	authenticating,
	loggedIn,
}) => {
	if (authenticating) {
		return <LoadingSpinner />;
	}
	if (!loggedIn) {
		return <Navigate replace={true} to="/login" />;
	}
	return <>{children}</>;
};

export default Layout;
