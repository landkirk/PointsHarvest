module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'site/static': '.' });
  eleventyConfig.addPassthroughCopy({ 'site/blog/*.md': 'blog' });

  eleventyConfig.addCollection('posts', (api) =>
    api.getFilteredByTag('post').sort((a, b) => b.date - a.date),
  );

  eleventyConfig.addFilter('formatDate', (date) =>
    new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }),
  );

  eleventyConfig.addFilter('isoDate', (date) =>
    new Date(date).toISOString().slice(0, 10),
  );

  return {
    dir: {
      input: 'site',
      output: 'docs',
      includes: '_includes',
      data: '_data',
    },
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
  };
};
