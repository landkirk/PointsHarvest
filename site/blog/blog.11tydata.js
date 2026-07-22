module.exports = {
  layout: 'post.njk',
  tags: 'post',
  permalink: '/blog/{{ page.fileSlug }}/index.html',
  eleventyComputed: {
    markdownUrl: (data) => `/blog/${data.page.fileSlug}.md`,
  },
};
