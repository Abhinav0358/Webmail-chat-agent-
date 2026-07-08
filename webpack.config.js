const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    agent: './src/agent.js',
    content: './src/content.js',
    background: './src/background.js'
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "src/sidepanel.html", to: "sidepanel.html" },
        { from: "src/sidepanel.css", to: "sidepanel.css" },
      ],
    }),
    // This plugin strips the "node:" prefix from imports so Webpack can apply the fallbacks
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, "");
    }),
  ],
  resolve: {
    extensions: ['.js'],
    alias: {
      "async_hooks": path.resolve(__dirname, 'src/mock-async-hooks.js'),
    },
    fallback: {
      "fs": false,
      "crypto": false
    }
  },
  experiments: {
    topLevelAwait: true
  }
};
